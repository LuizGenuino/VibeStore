-- VibeStore / Modulo 07: despesas pagas e ERP gerencial
-- Dependencias: migrations 001..006 do reinicio. Executar UMA VEZ em desenvolvimento.
-- BRL. Sem contas bancarias, contas a pagar/receber, contabilidade fiscal ou gateways.
-- Despesas operacionais e compras de estoque sao separadas para evitar dupla contagem.
BEGIN;
CREATE TABLE public.expense_categories(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 2 AND 100),
 classification text NOT NULL CHECK(classification IN('OPERATING','INVENTORY_PURCHASE')),
 is_active boolean NOT NULL DEFAULT true,request_id uuid NOT NULL,request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT expense_categories_store_identity UNIQUE(id,store_id),CONSTRAINT expense_categories_request UNIQUE(store_id,request_id)
);
CREATE UNIQUE INDEX expense_categories_store_name ON public.expense_categories(store_id,lower(btrim(name)));
CREATE TABLE public.expense_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 category_id uuid NOT NULL,category_name_snapshot text NOT NULL,
 classification text NOT NULL CHECK(classification IN('OPERATING','INVENTORY_PURCHASE')),
 kind text NOT NULL CHECK(kind IN('EXPENSE','CORRECTION','REFUND')),
 amount numeric(12,2) NOT NULL CHECK(amount>0 AND amount<>'NaN'::numeric),
 method text NOT NULL CHECK(method IN('PIX','CASH','BANK_TRANSFER','CARD','OTHER')),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 3 AND 500),
 external_reference text CHECK(external_reference IS NULL OR char_length(external_reference)<=160),
 occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
 recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,inventory_movement_id uuid UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
 reversal_of_id uuid UNIQUE REFERENCES public.expense_entries(id) ON DELETE RESTRICT,
 CONSTRAINT expense_entries_category_store FOREIGN KEY(category_id,store_id) REFERENCES public.expense_categories(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT expense_entries_request UNIQUE(store_id,request_id),
 CONSTRAINT expense_entries_reversal CHECK((kind='EXPENSE')=(reversal_of_id IS NULL)),
 CONSTRAINT expense_entries_stock_link CHECK(inventory_movement_id IS NULL OR(kind='EXPENSE' AND classification='INVENTORY_PURCHASE'))
);
CREATE INDEX expense_entries_store_period_idx ON public.expense_entries(store_id,occurred_at,id);
CREATE INDEX expense_entries_category_period_idx ON public.expense_entries(store_id,category_id,occurred_at);
COMMENT ON COLUMN public.expense_entries.kind IS 'CORRECTION corrige erro na data original; REFUND registra devolucao efetiva de dinheiro em sua propria data.';
COMMENT ON COLUMN public.expense_entries.occurred_at IS 'Data efetiva declarada do pagamento/reembolso. recorded_at preserva quando foi registrado.';
CREATE TABLE private.erp_requests(
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,request_id uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,request_id)
);
REVOKE ALL ON private.erp_requests FROM PUBLIC,anon,authenticated;

ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions(code,module,description,is_system) VALUES
 ('expenses.read','expenses','Consultar categorias e lancamentos de despesas.',true),
 ('expenses.categories.manage','expenses','Criar, renomear e ativar/desativar categorias.',true),
 ('expenses.record','expenses','Declarar despesas pagas e compras de estoque.',true),
 ('expenses.reverse','expenses','Corrigir lancamento ou declarar reembolso recebido.',true),
 ('reports.read','reports','Consultar ERP gerencial com valores financeiros e custos.',true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN('OWNER','SUDO') AND p.code IN('expenses.read','expenses.categories.manage','expenses.record','expenses.reverse','reports.read');

CREATE FUNCTION private.lock_erp_store(p_store_id uuid,p_permission text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM private.lock_catalog_store(p_store_id,p_permission);END; $$;
CREATE FUNCTION private.erp_cached(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.erp_requests%ROWTYPE;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_REQUIRED' USING ERRCODE='22004';END IF;
 SELECT * INTO r FROM private.erp_requests WHERE store_id=p_store_id AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='22023';END IF;
  RETURN r.result||'{"replayed":true}'::jsonb;
 END IF;RETURN NULL;
END; $$;
CREATE FUNCTION private.erp_validate_description(p_description text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 3 AND 500 THEN
 RAISE EXCEPTION 'INVALID_EXPENSE_DESCRIPTION' USING ERRCODE='22023';END IF;END; $$;
CREATE FUNCTION private.erp_validate_timestamp(p_timestamp timestamptz)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
BEGIN IF p_timestamp IS NULL OR p_timestamp<'2000-01-01T00:00:00Z'::timestamptz OR p_timestamp>clock_timestamp()+interval '5 minutes' THEN
 RAISE EXCEPTION 'INVALID_EXPENSE_TIMESTAMP' USING ERRCODE='22023';END IF;END; $$;
CREATE FUNCTION private.guard_expense_category()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_DELETE_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.classification IS DISTINCT FROM OLD.classification
 OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_payload IS DISTINCT FROM OLD.request_payload THEN
  RAISE EXCEPTION 'EXPENSE_CATEGORY_IDENTITY_IMMUTABLE' USING ERRCODE='42501';END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END; $$;
CREATE FUNCTION private.immutable_expense_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'EXPENSE_LEDGER_IMMUTABLE' USING ERRCODE='42501';END; $$;
CREATE TRIGGER expense_categories_guard BEFORE UPDATE OR DELETE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION private.guard_expense_category();
CREATE TRIGGER expense_entries_immutable BEFORE UPDATE OR DELETE ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION private.immutable_expense_entry();
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_categories,public.expense_entries FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.expense_categories,public.expense_entries TO authenticated,service_role;
CREATE POLICY expense_categories_read ON public.expense_categories FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'expenses.read'));
CREATE POLICY expense_entries_read ON public.expense_entries FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'expenses.read'));

CREATE FUNCTION public.create_expense_category(p_store_id uuid,p_request_id uuid,p_name text,p_classification text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE payload jsonb;r jsonb;c public.expense_categories%ROWTYPE;
BEGIN
 PERFORM private.lock_erp_store(p_store_id,'expenses.categories.manage');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 100 OR p_classification IS NULL
 OR p_classification NOT IN('OPERATING','INVENTORY_PURCHASE') THEN RAISE EXCEPTION 'INVALID_EXPENSE_CATEGORY' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','category','name',btrim(p_name),'classification',p_classification);
 r:=private.erp_cached(p_store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 INSERT INTO public.expense_categories(store_id,name,classification,request_id,request_payload)
 VALUES(p_store_id,btrim(p_name),p_classification,p_request_id,payload) RETURNING * INTO c;
 r:=jsonb_build_object('category_id',c.id,'name',c.name,'classification',c.classification,'replayed',false);
 INSERT INTO private.erp_requests(store_id,request_id,payload,result) VALUES(p_store_id,p_request_id,payload,r);RETURN r;
END; $$;
CREATE FUNCTION public.update_expense_category(p_category_id uuid,p_request_id uuid,p_name text,p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.expense_categories%ROWTYPE;payload jsonb;r jsonb;
BEGIN
 SELECT * INTO c FROM public.expense_categories WHERE id=p_category_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM private.lock_erp_store(c.store_id,'expenses.categories.manage');
 IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 100 OR p_active IS NULL THEN RAISE EXCEPTION 'INVALID_EXPENSE_CATEGORY' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','update_category','category_id',c.id,'name',btrim(p_name),'active',p_active);
 r:=private.erp_cached(c.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 UPDATE public.expense_categories SET name=btrim(p_name),is_active=p_active WHERE id=c.id;
 r:=jsonb_build_object('category_id',c.id,'name',btrim(p_name),'is_active',p_active,'replayed',false);
 INSERT INTO private.erp_requests(store_id,request_id,payload,result) VALUES(c.store_id,p_request_id,payload,r);RETURN r;
END; $$;

CREATE FUNCTION public.record_expense(p_store_id uuid,p_request_id uuid,p_category_id uuid,p_amount numeric,
 p_method text,p_description text,p_occurred_at timestamptz,p_reference text DEFAULT NULL,p_inventory_movement_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.expense_categories%ROWTYPE;e public.expense_entries%ROWTYPE;payload jsonb;r jsonb;
BEGIN
 PERFORM private.lock_erp_store(p_store_id,'expenses.record');PERFORM private.erp_validate_description(p_description);
 PERFORM private.erp_validate_timestamp(p_occurred_at);PERFORM private.validate_manual_method(p_method,p_reference);
 IF p_amount IS NULL OR p_amount='NaN'::numeric OR p_amount<=0 OR p_amount>9999999999.99 OR p_amount<>round(p_amount,2) THEN
  RAISE EXCEPTION 'INVALID_EXPENSE_AMOUNT' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','expense','category_id',p_category_id,'amount',p_amount,'method',p_method,
  'description',btrim(p_description),'occurred_at',p_occurred_at,'reference',NULLIF(btrim(p_reference),''),'inventory_movement_id',p_inventory_movement_id);
 r:=private.erp_cached(p_store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 SELECT * INTO c FROM public.expense_categories WHERE id=p_category_id AND store_id=p_store_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_CATEGORY_UNAVAILABLE' USING ERRCODE='22023';END IF;
 IF p_inventory_movement_id IS NOT NULL THEN
  IF c.classification<>'INVENTORY_PURCHASE' OR NOT EXISTS(SELECT 1 FROM public.inventory_movements m WHERE m.id=p_inventory_movement_id
   AND m.store_id=p_store_id AND m.movement_type='ENTRY' AND NOT EXISTS(SELECT 1 FROM public.order_stock_operations s WHERE s.movement_id=m.id)) THEN
   RAISE EXCEPTION 'INVALID_PURCHASE_STOCK_REFERENCE' USING ERRCODE='22023';END IF;
 END IF;
 INSERT INTO public.expense_entries(store_id,category_id,category_name_snapshot,classification,kind,amount,method,description,
  external_reference,occurred_at,recorded_by,request_id,inventory_movement_id)
 VALUES(p_store_id,c.id,c.name,c.classification,'EXPENSE',p_amount,p_method,btrim(p_description),NULLIF(btrim(p_reference),''),p_occurred_at,auth.uid(),p_request_id,p_inventory_movement_id)
 RETURNING * INTO e;
 r:=jsonb_build_object('expense_id',e.id,'amount',e.amount,'classification',e.classification,'occurred_at',e.occurred_at,'replayed',false);
 INSERT INTO private.erp_requests(store_id,request_id,payload,result) VALUES(p_store_id,p_request_id,payload,r);RETURN r;
END; $$;
CREATE FUNCTION public.reverse_expense(p_expense_id uuid,p_request_id uuid,p_kind text,p_description text,
 p_occurred_at timestamptz DEFAULT NULL,p_method text DEFAULT NULL,p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.expense_entries%ROWTYPE;n public.expense_entries%ROWTYPE;payload jsonb;r jsonb;effective_at timestamptz;method text;
BEGIN
 SELECT * INTO e FROM public.expense_entries WHERE id=p_expense_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM private.lock_erp_store(e.store_id,'expenses.reverse');PERFORM private.erp_validate_description(p_description);
 IF p_kind IS NULL OR p_kind NOT IN('CORRECTION','REFUND') THEN RAISE EXCEPTION 'INVALID_EXPENSE_REVERSAL_KIND' USING ERRCODE='22023';END IF;
 IF p_kind='CORRECTION' THEN
  IF p_occurred_at IS NOT NULL OR p_method IS NOT NULL OR p_reference IS NOT NULL THEN RAISE EXCEPTION 'CORRECTION_USES_ORIGINAL_DATE' USING ERRCODE='22023';END IF;
  effective_at:=e.occurred_at;method:=e.method;
 ELSE
  PERFORM private.erp_validate_timestamp(p_occurred_at);PERFORM private.validate_manual_method(p_method,p_reference);
  IF p_occurred_at<e.occurred_at THEN RAISE EXCEPTION 'REFUND_BEFORE_EXPENSE' USING ERRCODE='22023';END IF;
  effective_at:=p_occurred_at;method:=p_method;
 END IF;
 payload:=jsonb_build_object('operation','reverse_expense','expense_id',e.id,'kind',p_kind,'description',btrim(p_description),
  'occurred_at',effective_at,'method',method,'reference',NULLIF(btrim(p_reference),''));
 r:=private.erp_cached(e.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 IF e.kind<>'EXPENSE' OR EXISTS(SELECT 1 FROM public.expense_entries WHERE reversal_of_id=e.id) THEN
  RAISE EXCEPTION 'EXPENSE_ALREADY_REVERSED_OR_NOT_ORIGINAL' USING ERRCODE='22023';END IF;
 INSERT INTO public.expense_entries(store_id,category_id,category_name_snapshot,classification,kind,amount,method,
  description,external_reference,occurred_at,recorded_by,request_id,reversal_of_id)
 VALUES(e.store_id,e.category_id,e.category_name_snapshot,e.classification,p_kind,e.amount,method,btrim(p_description),
  NULLIF(btrim(p_reference),''),effective_at,auth.uid(),p_request_id,e.id) RETURNING * INTO n;
 r:=jsonb_build_object('expense_id',n.id,'reversal_of_id',e.id,'kind',p_kind,'amount',e.amount,'occurred_at',effective_at,'replayed',false);
 INSERT INTO private.erp_requests(store_id,request_id,payload,result) VALUES(e.store_id,p_request_id,payload,r);RETURN r;
END; $$;


-- Fatos assinados. Nunca filtrar vendas historicas pelo status ATUAL do pedido.
-- Uma devolucao reduz o CMV integral e reclassifica apenas o dano como perda.
CREATE FUNCTION private.erp_facts(p_store_id uuid)
RETURNS TABLE(event_at timestamptz,source text,source_id uuid,order_id uuid,
 goods_revenue numeric,shipping_revenue numeric,cogs numeric,returned_loss numeric,adjustment_cost numeric,
 operating_expense numeric,inventory_purchase numeric,cash_in numeric,cash_out numeric,
 unclassified_outbound numeric,unclassified_count integer,units_sold integer,units_restocked integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p.confirmed_at,'ORDER_RECEIPT',p.id,p.order_id,o.subtotal,o.shipping_amount,
  0::numeric,0::numeric,0::numeric,0::numeric,0::numeric,p.amount,0::numeric,0::numeric,0,0,0
 FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id WHERE p.store_id=p_store_id AND p.kind='RECEIPT'
 UNION ALL
 SELECT p.confirmed_at,'ORDER_REFUND',p.id,p.order_id,-o.subtotal,-o.shipping_amount,
  -COALESCE((SELECT sum(s.allocated_value) FROM public.order_stock_operations s WHERE s.order_id=o.id AND s.kind='SALE'),0),
  COALESCE((SELECT sum(r.loss_value) FROM public.order_return_items r WHERE r.order_id=o.id),0),
  0,0,0,0,p.amount,0,0,0,
  COALESCE((SELECT sum(s.quantity) FROM public.order_stock_operations s WHERE s.order_id=o.id AND s.kind='RESTOCK'),0)::integer
 FROM public.order_payments p JOIN public.orders o ON o.id=p.order_id WHERE p.store_id=p_store_id AND p.kind='REFUND'
 UNION ALL
 SELECT m.created_at,'ORDER_COGS',s.id,s.order_id,0,0,s.allocated_value,0,0,0,0,0,0,0,0,s.quantity,0
 FROM public.order_stock_operations s JOIN public.inventory_movements m ON m.id=s.movement_id
 WHERE s.store_id=p_store_id AND s.kind='SALE'
 UNION ALL
 SELECT e.occurred_at,'EXPENSE_'||e.kind,e.id,NULL::uuid,0,0,0,0,0,
  CASE WHEN e.classification='OPERATING' THEN CASE WHEN e.kind='EXPENSE' THEN e.amount ELSE -e.amount END ELSE 0 END,
  CASE WHEN e.classification='INVENTORY_PURCHASE' THEN CASE WHEN e.kind='EXPENSE' THEN e.amount ELSE -e.amount END ELSE 0 END,
  CASE WHEN e.kind='REFUND' THEN e.amount ELSE 0 END,
  CASE WHEN e.kind='EXPENSE' THEN e.amount WHEN e.kind='CORRECTION' THEN -e.amount ELSE 0 END,0,0,0,0
 FROM public.expense_entries e WHERE e.store_id=p_store_id
 UNION ALL
 SELECT m.created_at,'STOCK_ADJUSTMENT',m.id,NULL::uuid,0,0,0,0,-m.value_delta,0,0,0,0,0,0,0,0
 FROM public.inventory_movements m WHERE m.store_id=p_store_id AND m.movement_type IN('ADJUSTMENT_IN','ADJUSTMENT_OUT')
 UNION ALL
 SELECT m.created_at,'STOCK_ADJUSTMENT_REVERSAL',m.id,NULL::uuid,0,0,0,0,-m.value_delta,0,0,0,0,0,0,0,0
 FROM public.inventory_movements m JOIN public.inventory_movements original ON original.id=m.reversal_of_id
 WHERE m.store_id=p_store_id AND m.movement_type='REVERSAL' AND original.movement_type IN('ADJUSTMENT_IN','ADJUSTMENT_OUT')
 UNION ALL
 SELECT m.created_at,'UNCLASSIFIED_STOCK_EXIT',m.id,NULL::uuid,0,0,0,0,0,0,0,0,0,-m.value_delta,1,0,0
 FROM public.inventory_movements m WHERE m.store_id=p_store_id AND m.movement_type='EXIT'
 AND NOT EXISTS(SELECT 1 FROM public.order_stock_operations s WHERE s.movement_id=m.id)
 UNION ALL
 SELECT m.created_at,'UNCLASSIFIED_STOCK_EXIT_REVERSAL',m.id,NULL::uuid,0,0,0,0,0,0,0,0,0,-m.value_delta,1,0,0
 FROM public.inventory_movements m JOIN public.inventory_movements original ON original.id=m.reversal_of_id
 WHERE m.store_id=p_store_id AND m.movement_type='REVERSAL' AND original.movement_type='EXIT'
 AND NOT EXISTS(SELECT 1 FROM public.order_stock_operations s WHERE s.movement_id=original.id);
$$;

CREATE FUNCTION private.erp_window(p_store_id uuid,p_from date,p_to date,p_timezone text)
RETURNS tstzrange LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT private.catalog_store_allowed(p_store_id,'reports.read') THEN RAISE EXCEPTION 'REPORT_FORBIDDEN' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from OR p_to-p_from>365 OR p_timezone IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN
  RAISE EXCEPTION 'INVALID_REPORT_PERIOD_OR_TIMEZONE' USING ERRCODE='22023';END IF;
 RETURN tstzrange(p_from::timestamp AT TIME ZONE p_timezone,(p_to+1)::timestamp AT TIME ZONE p_timezone,'[)');
END; $$;

CREATE FUNCTION public.get_erp_summary(p_store_id uuid,p_from date,p_to date,p_timezone text DEFAULT 'America/Sao_Paulo')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window tstzrange;totals record;inventory record;result numeric;
BEGIN
 v_window:=private.erp_window(p_store_id,p_from,p_to,p_timezone);
 SELECT COALESCE(sum(goods_revenue),0) AS goods,COALESCE(sum(shipping_revenue),0) AS shipping,
 COALESCE(sum(cogs),0) AS cogs,COALESCE(sum(returned_loss),0) AS returned_loss,
 COALESCE(sum(adjustment_cost),0) AS adjustments,COALESCE(sum(operating_expense),0) AS operating,
 COALESCE(sum(inventory_purchase),0) AS purchases,COALESCE(sum(cash_in),0) AS cash_in,COALESCE(sum(cash_out),0) AS cash_out,
 COALESCE(sum(unclassified_outbound),0) AS unclassified,COALESCE(sum(unclassified_count),0) AS unclassified_count,
 COALESCE(sum(units_sold),0) AS units_sold,COALESCE(sum(units_restocked),0) AS units_restocked,
 count(*) FILTER(WHERE source='ORDER_RECEIPT') AS receipts,count(*) FILTER(WHERE source='ORDER_REFUND') AS refunds
 INTO totals FROM private.erp_facts(p_store_id) WHERE event_at<@v_window;
 SELECT COALESCE(sum(b.quantity),0) AS quantity,COALESCE(sum(b.stock_value),0) AS value,
 COALESCE(sum(private.active_reserved_quantity(b.product_id)),0) AS reserved INTO inventory
 FROM public.inventory_balances b WHERE b.store_id=p_store_id;
 result:=totals.goods+totals.shipping-totals.cogs-totals.returned_loss-totals.adjustments-totals.operating;
 RETURN jsonb_build_object('store_id',p_store_id,'from',p_from,'to',p_to,'timezone',p_timezone,
  'net_goods_revenue',totals.goods,'net_shipping_revenue',totals.shipping,'net_revenue',totals.goods+totals.shipping,
  'net_cogs',totals.cogs,'returned_damage_loss',totals.returned_loss,'inventory_adjustment_cost',totals.adjustments,
  'net_operating_expenses',totals.operating,'net_inventory_purchase_cash',totals.purchases,
  'gross_margin',totals.goods+totals.shipping-totals.cogs,
  'estimated_operating_result',result,
  'operating_margin_percent',CASE WHEN totals.goods+totals.shipping>0 THEN round(result/(totals.goods+totals.shipping)*100,2) ELSE NULL END,
  'cash_received',totals.cash_in,'cash_paid_net',totals.cash_out,'net_cash_flow',totals.cash_in-totals.cash_out,
  'receipt_count',totals.receipts,'refund_count',totals.refunds,'units_sold',totals.units_sold,'units_restocked',totals.units_restocked,
  'average_receipt',CASE WHEN totals.receipts>0 THEN(SELECT round(avg(amount),2) FROM public.order_payments WHERE store_id=p_store_id AND kind='RECEIPT' AND confirmed_at<@v_window) ELSE NULL END,
  'unclassified_stock_outbound_value',totals.unclassified,'unclassified_stock_event_count',totals.unclassified_count,
  'needs_stock_review',totals.unclassified_count>0,'is_estimate',true,'accounting_basis','manual_cash_based_management',
  'inventory_snapshot_current',jsonb_build_object('quantity',inventory.quantity,'stock_value',inventory.value,'reserved_quantity',inventory.reserved),
  'warnings',jsonb_build_array('Nao e lucro fiscal/contabil nem saldo bancario.',
   'Compras de estoque afetam caixa, nao sao despesa operacional duplicada.',
   'Saidas manuais sem pedido nao entram automaticamente no resultado.',
   'Snapshot de estoque e atual, nao fechamento historico do periodo.'));
END; $$;

CREATE FUNCTION public.get_erp_daily(p_store_id uuid,p_from date,p_to date,p_timezone text DEFAULT 'America/Sao_Paulo')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window tstzrange;rows jsonb;
BEGIN
 v_window:=private.erp_window(p_store_id,p_from,p_to,p_timezone);
 WITH days AS(SELECT p_from+n AS day FROM generate_series(0,p_to-p_from)n),
 facts AS(SELECT(event_at AT TIME ZONE p_timezone)::date AS day,
  sum(goods_revenue+shipping_revenue) AS revenue,sum(cogs) AS cogs,sum(returned_loss) AS damage,
  sum(adjustment_cost) AS adjustments,sum(operating_expense) AS operating,
  sum(cash_in) AS cash_in,sum(cash_out) AS cash_out FROM private.erp_facts(p_store_id) WHERE event_at<@v_window
  GROUP BY(event_at AT TIME ZONE p_timezone)::date)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('date',d.day,'net_revenue',COALESCE(f.revenue,0),
  'net_cogs',COALESCE(f.cogs,0),'returned_damage_loss',COALESCE(f.damage,0),
  'net_operating_expenses',COALESCE(f.operating,0),'inventory_adjustment_cost',COALESCE(f.adjustments,0),
  'estimated_operating_result',COALESCE(f.revenue,0)-COALESCE(f.cogs,0)-COALESCE(f.damage,0)-COALESCE(f.adjustments,0)-COALESCE(f.operating,0),
  'cash_received',COALESCE(f.cash_in,0),'cash_paid_net',COALESCE(f.cash_out,0),
  'net_cash_flow',COALESCE(f.cash_in,0)-COALESCE(f.cash_out,0)) ORDER BY d.day),'[]'::jsonb) INTO rows
 FROM days d LEFT JOIN facts f ON f.day=d.day;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'timezone',p_timezone,'days',rows);
END; $$;

CREATE FUNCTION public.get_erp_product_performance(p_store_id uuid,p_from date,p_to date,p_timezone text DEFAULT 'America/Sao_Paulo',p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window tstzrange;rows jsonb;
BEGIN
 v_window:=private.erp_window(p_store_id,p_from,p_to,p_timezone);
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_REPORT_LIMIT' USING ERRCODE='22023';END IF;
 WITH movements AS(
 SELECT i.product_id,i.product_code,i.product_name,p.confirmed_at,CASE WHEN p.kind='RECEIPT' THEN i.quantity ELSE -i.quantity END AS sold_units,
  CASE WHEN p.kind='RECEIPT' THEN i.line_total ELSE -i.line_total END AS goods_revenue,
  CASE WHEN p.kind='RECEIPT' THEN COALESCE(s.allocated_value,0) ELSE -COALESCE(s.allocated_value,0) END AS cogs,
  CASE WHEN p.kind='REFUND' THEN COALESCE(r.loss_value,0) ELSE 0 END AS damage
 FROM public.order_payments p JOIN public.order_items i ON i.order_id=p.order_id
 LEFT JOIN public.order_stock_operations s ON s.order_item_id=i.id AND s.kind='SALE'
 LEFT JOIN public.order_return_items r ON r.order_item_id=i.id
 WHERE p.store_id=p_store_id AND p.confirmed_at<@v_window
 ),aggregate AS(SELECT product_id,max(product_code) AS code,
  (array_agg(product_name ORDER BY confirmed_at DESC))[1] AS name,
  sum(sold_units) AS net_units,sum(goods_revenue) AS net_goods_revenue,sum(cogs) AS net_cogs,sum(damage) AS damage_loss
 FROM movements GROUP BY product_id ORDER BY sum(goods_revenue) DESC,product_id LIMIT p_limit)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id',product_id,'code',code,'name_snapshot',name,
  'net_units',net_units,'net_goods_revenue',net_goods_revenue,'net_cogs',net_cogs,'damage_loss',damage_loss,
  'contribution_before_shared_expenses',net_goods_revenue-net_cogs-damage_loss) ORDER BY net_goods_revenue DESC,product_id),'[]') INTO rows FROM aggregate;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'products',rows,
  'note','Frete e despesas gerais nao sao rateados entre os produtos.');
END; $$;

CREATE FUNCTION public.get_erp_expense_breakdown(p_store_id uuid,p_from date,p_to date,p_timezone text DEFAULT 'America/Sao_Paulo')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window tstzrange;rows jsonb;
BEGIN
 v_window:=private.erp_window(p_store_id,p_from,p_to,p_timezone);
 WITH grouped AS(SELECT category_id,classification,category_name_snapshot,
  sum(CASE WHEN kind='EXPENSE' THEN amount ELSE -amount END) AS amount
 FROM public.expense_entries WHERE store_id=p_store_id AND occurred_at<@v_window
 GROUP BY category_id,classification,category_name_snapshot)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('category_id',category_id,'name_snapshot',category_name_snapshot,
  'classification',classification,'net_amount',amount) ORDER BY classification,amount DESC),'[]') INTO rows FROM grouped;
 RETURN jsonb_build_object('from',p_from,'to',p_to,'categories',rows);
END; $$;

CREATE TRIGGER expense_categories_audit AFTER INSERT OR UPDATE ON public.expense_categories FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER expense_entries_audit AFTER INSERT ON public.expense_entries FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
REVOKE ALL ON FUNCTION private.lock_erp_store(uuid,text),private.erp_cached(uuid,uuid,jsonb),private.erp_validate_description(text),
 private.erp_validate_timestamp(timestamptz),private.guard_expense_category(),private.immutable_expense_entry(),private.erp_facts(uuid),
 private.erp_window(uuid,date,date,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_expense_category(uuid,uuid,text,text),public.update_expense_category(uuid,uuid,text,boolean),
 public.record_expense(uuid,uuid,uuid,numeric,text,text,timestamptz,text,uuid),
 public.reverse_expense(uuid,uuid,text,text,timestamptz,text,text),
 public.get_erp_summary(uuid,date,date,text),public.get_erp_daily(uuid,date,date,text),
 public.get_erp_product_performance(uuid,date,date,text,integer),public.get_erp_expense_breakdown(uuid,date,date,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_category(uuid,uuid,text,text),public.update_expense_category(uuid,uuid,text,boolean),
 public.record_expense(uuid,uuid,uuid,numeric,text,text,timestamptz,text,uuid),
 public.reverse_expense(uuid,uuid,text,text,timestamptz,text,text),
 public.get_erp_summary(uuid,date,date,text),public.get_erp_daily(uuid,date,date,text),
 public.get_erp_product_performance(uuid,date,date,text,integer),public.get_erp_expense_breakdown(uuid,date,date,text)
 TO authenticated;
COMMIT;
