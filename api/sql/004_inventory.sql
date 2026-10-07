-- VibeStore / Modulo 04: estoque e custo medio movel
-- Dependencias: migrations 001, 002, 003 do reinicio.
-- Quantidades inteiras. Sem reservas, vendas vinculadas, pagamentos ou FIFO.
-- Executar UMA VEZ em Supabase de desenvolvimento.
BEGIN;
CREATE TYPE public.inventory_movement_type AS ENUM
 ('ENTRY','EXIT','ADJUSTMENT_IN','ADJUSTMENT_OUT','REVERSAL');

CREATE TABLE public.inventory_balances (
 product_id uuid PRIMARY KEY,
 store_id uuid NOT NULL,
 quantity integer NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000000),
 stock_value numeric(26,6) NOT NULL DEFAULT 0 CHECK (stock_value >= 0 AND stock_value <> 'NaN'::numeric),
 average_cost numeric(18,6) GENERATED ALWAYS AS
  (CASE WHEN quantity = 0 THEN 0 ELSE round(stock_value / quantity,6) END) STORED,
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 last_movement_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT inventory_balances_product_store FOREIGN KEY (product_id,store_id)
  REFERENCES public.products(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_balances_zero_quantity CHECK (quantity > 0 OR stock_value = 0)
);
CREATE INDEX inventory_balances_store_idx ON public.inventory_balances(store_id,product_id);
COMMENT ON TABLE public.inventory_balances IS 'Projecao operacional do ledger. Somente RPC pode alterar; nunca editar quantidade diretamente.';

CREATE TABLE public.inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 product_code text NOT NULL,
 product_name text NOT NULL,
 request_id uuid NOT NULL,
 batch_request_id uuid,
 movement_type public.inventory_movement_type NOT NULL,
 quantity_delta integer NOT NULL CHECK (quantity_delta <> 0 AND quantity_delta BETWEEN -1000000000 AND 1000000000),
 unit_cost numeric(18,6) NOT NULL CHECK (unit_cost >= 0 AND unit_cost <> 'NaN'::numeric),
 value_delta numeric(26,6) NOT NULL CHECK (value_delta <> 'NaN'::numeric),
 quantity_before integer NOT NULL CHECK (quantity_before >= 0),
 quantity_after integer NOT NULL CHECK (quantity_after BETWEEN 0 AND 1000000000),
 value_before numeric(26,6) NOT NULL CHECK (value_before >= 0 AND value_before <> 'NaN'::numeric),
 value_after numeric(26,6) NOT NULL CHECK (value_after >= 0 AND value_after <> 'NaN'::numeric),
 average_cost_before numeric(18,6) NOT NULL CHECK (average_cost_before >= 0),
 average_cost_after numeric(18,6) NOT NULL CHECK (average_cost_after >= 0),
 revision bigint NOT NULL CHECK (revision > 0),
 reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
 reference text CHECK (reference IS NULL OR char_length(reference) <= 120),
 reversal_of_id uuid UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT inventory_movements_product_store FOREIGN KEY (product_id,store_id)
  REFERENCES public.products(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_movements_request UNIQUE (store_id,request_id),
 CONSTRAINT inventory_movements_revision UNIQUE (product_id,revision),
 CONSTRAINT inventory_movements_quantity CHECK (quantity_after::bigint = quantity_before::bigint + quantity_delta::bigint),
 CONSTRAINT inventory_movements_value CHECK (value_after = value_before + value_delta),
 CONSTRAINT inventory_movements_zero_value CHECK ((quantity_before > 0 OR value_before = 0) AND (quantity_after > 0 OR value_after = 0)),
 CONSTRAINT inventory_movements_sign CHECK (
  (movement_type IN ('ENTRY','ADJUSTMENT_IN') AND quantity_delta > 0 AND value_delta >= 0)
  OR (movement_type IN ('EXIT','ADJUSTMENT_OUT') AND quantity_delta < 0 AND value_delta <= 0)
  OR movement_type = 'REVERSAL'
 ),
 CONSTRAINT inventory_movements_reversal CHECK ((movement_type = 'REVERSAL') = (reversal_of_id IS NOT NULL))
);
ALTER TABLE public.inventory_balances ADD CONSTRAINT inventory_balances_last_movement
 FOREIGN KEY (last_movement_id) REFERENCES public.inventory_movements(id) ON DELETE RESTRICT;
CREATE INDEX inventory_movements_store_date_idx ON public.inventory_movements(store_id,created_at DESC,id);
CREATE INDEX inventory_movements_product_date_idx ON public.inventory_movements(product_id,revision DESC);
CREATE INDEX inventory_movements_batch_idx ON public.inventory_movements(store_id,batch_request_id) WHERE batch_request_id IS NOT NULL;
COMMENT ON COLUMN public.inventory_movements.unit_cost IS 'Custo unitario informativo com seis casas. value_delta e o valor contabil exato alocado.';
COMMENT ON COLUMN public.inventory_movements.reason IS 'Motivo obrigatorio; saida manual nao comprova venda ou recebimento.';

CREATE TABLE private.inventory_requests (
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,
 payload jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_id,request_id)
);
ALTER TABLE private.inventory_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.inventory_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.inventory_requests TO service_role;

ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions(code,module,description,is_system) VALUES
 ('inventory.read','inventory','Consultar saldo, valor de estoque e historico de movimentos.',true),
 ('inventory.entry','inventory','Registrar entradas manuais de estoque.',true),
 ('inventory.exit','inventory','Registrar saidas manuais de estoque.',true),
 ('inventory.adjust','inventory','Ajustar contagem fisica individual ou em lote.',true),
 ('inventory.reverse','inventory','Reverter o ultimo movimento ainda nao revertido.',true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN ('OWNER','SUDO') AND p.module = 'inventory';

CREATE FUNCTION private.inventory_permission(p_type public.inventory_movement_type)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE p_type WHEN 'ENTRY' THEN 'inventory.entry' WHEN 'EXIT' THEN 'inventory.exit'
  WHEN 'REVERSAL' THEN 'inventory.reverse' ELSE 'inventory.adjust' END;
$$;

CREATE FUNCTION private.guard_inventory_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b public.inventory_balances%ROWTYPE; p public.products%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'INVENTORY_LEDGER_IMMUTABLE' USING ERRCODE = '42501'; END IF;
 PERFORM private.lock_catalog_store(NEW.store_id,private.inventory_permission(NEW.movement_type));
 SELECT * INTO p FROM public.products WHERE id=NEW.product_id AND store_id=NEW.store_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO b FROM public.inventory_balances WHERE product_id=NEW.product_id FOR UPDATE;
 IF NOT FOUND OR NEW.revision <> b.revision+1 OR NEW.quantity_before <> b.quantity
  OR NEW.value_before <> b.stock_value THEN
  RAISE EXCEPTION 'INVALID_LEDGER_CHAIN' USING ERRCODE = '22023'; END IF;
 NEW.product_code := p.code; NEW.product_name := p.name; NEW.created_by := auth.uid();
 RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_inventory_projection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.inventory_movements%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'INVENTORY_PROJECTION_DELETE_FORBIDDEN' USING ERRCODE = '42501'; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.quantity <> 0 OR NEW.stock_value <> 0 OR NEW.revision <> 0 OR NEW.last_movement_id IS NOT NULL THEN
   RAISE EXCEPTION 'INVENTORY_INITIAL_BALANCE_MUST_BE_ZERO' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.store_id IS DISTINCT FROM OLD.store_id
  OR NEW.revision <> OLD.revision+1 THEN
  RAISE EXCEPTION 'INVALID_PROJECTION_UPDATE' USING ERRCODE = '22023'; END IF;
 SELECT * INTO m FROM public.inventory_movements WHERE id=NEW.last_movement_id;
 IF NOT FOUND OR m.product_id <> NEW.product_id OR m.store_id <> NEW.store_id
 OR m.revision <> NEW.revision OR m.quantity_before <> OLD.quantity OR m.value_before <> OLD.stock_value
 OR m.quantity_after <> NEW.quantity OR m.value_after <> NEW.stock_value THEN
  RAISE EXCEPTION 'PROJECTION_REQUIRES_LEDGER' USING ERRCODE = '22023'; END IF;
 NEW.updated_at := pg_catalog.now();
 RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION private.guard_inventory_ledger();
CREATE TRIGGER inventory_balances_guard BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION private.guard_inventory_projection();
CREATE FUNCTION private.apply_inventory_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 UPDATE public.inventory_balances SET quantity=NEW.quantity_after,stock_value=NEW.value_after,
  revision=NEW.revision,last_movement_id=NEW.id WHERE product_id=NEW.product_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_PROJECTION_MISSING' USING ERRCODE = '22023'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_movements_apply AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION private.apply_inventory_movement();

-- Arquivar cadastro com estoque remanescente bloquearia a operacao posterior.
CREATE FUNCTION private.prevent_archive_with_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
  IF TG_TABLE_NAME = 'products' AND EXISTS(
   SELECT 1 FROM public.inventory_balances WHERE product_id=OLD.id AND quantity>0
  ) THEN RAISE EXCEPTION 'PRODUCT_HAS_STOCK' USING ERRCODE = '22023'; END IF;
  IF TG_TABLE_NAME = 'stores' AND EXISTS(
   SELECT 1 FROM public.inventory_balances WHERE store_id=OLD.id AND quantity>0
  ) THEN RAISE EXCEPTION 'STORE_HAS_STOCK' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER products_stock_archive_guard BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.prevent_archive_with_stock();
CREATE TRIGGER stores_stock_archive_guard BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION private.prevent_archive_with_stock();

ALTER TABLE public.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_balances,public.inventory_movements FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.inventory_balances,public.inventory_movements TO authenticated;
GRANT SELECT ON public.inventory_balances,public.inventory_movements TO service_role;
CREATE POLICY inventory_balances_read ON public.inventory_balances FOR SELECT TO authenticated
USING(private.catalog_store_allowed(store_id,'inventory.read'));
CREATE POLICY inventory_movements_read ON public.inventory_movements FOR SELECT TO authenticated
USING(private.catalog_store_allowed(store_id,'inventory.read'));

CREATE VIEW public.product_stock_balances WITH (security_invoker=true) AS
SELECT p.id AS product_id,p.store_id,p.code,p.name,p.status,p.category_id,
 COALESCE(b.quantity,0)::integer AS quantity,
 COALESCE(b.stock_value,0)::numeric(26,6) AS stock_value,
 COALESCE(b.average_cost,0)::numeric(18,6) AS average_cost,
 COALESCE(b.revision,0)::bigint AS revision,b.last_movement_id,b.updated_at
FROM public.products p LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.store_id=p.store_id
WHERE p.archived_at IS NULL AND private.catalog_store_allowed(p.store_id,'inventory.read');
REVOKE ALL ON public.product_stock_balances FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.product_stock_balances TO authenticated,service_role;
COMMENT ON VIEW public.product_stock_balances IS 'Saldo zero para produto ainda sem movimentos. Consulta autenticada requer catalog.read e inventory.read.';


CREATE FUNCTION private.inventory_assert_product(p_product_id uuid,p_permission text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.products WHERE id=p_product_id;
 IF NOT FOUND OR NOT private.catalog_product_allowed(p_product_id,p_permission) THEN
  RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
 PERFORM private.lock_catalog_store(p.store_id,p_permission);
 IF NOT private.catalog_product_allowed(p_product_id,p_permission) THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 RETURN p.store_id;
END;
$$;

CREATE FUNCTION private.inventory_validate_note(p_reason text,p_reference text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 500
 OR (p_reference IS NOT NULL AND char_length(btrim(p_reference))>120) THEN
  RAISE EXCEPTION 'INVALID_MOVEMENT_REASON_OR_REFERENCE' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE FUNCTION private.inventory_validate_unit_cost(p_cost numeric)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF p_cost IS NULL OR p_cost='NaN'::numeric OR p_cost<0 OR p_cost>9999999999.999999
 OR p_cost<>round(p_cost,6) THEN
  RAISE EXCEPTION 'INVALID_UNIT_COST' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE FUNCTION private.inventory_cached_request(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.inventory_requests%ROWTYPE;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_REQUIRED' USING ERRCODE = '22004'; END IF;
 SELECT * INTO r FROM private.inventory_requests WHERE store_id=p_store_id AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  RETURN r.result || '{"replayed":true}'::jsonb;
 END IF;
 RETURN NULL;
END;
$$;

CREATE FUNCTION private.post_inventory_movement(
 p_product_id uuid,p_request_id uuid,p_type public.inventory_movement_type,
 p_delta integer,p_unit_cost numeric,p_reason text,p_reference text,
 p_batch_request_id uuid DEFAULT NULL,p_reversal_of_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; b public.inventory_balances%ROWTYPE; original public.inventory_movements%ROWTYPE;
 m public.inventory_movements%ROWTYPE; q bigint; value_change numeric; value_after numeric;
 cost numeric; average_before numeric; average_after numeric;
BEGIN
 s:=private.inventory_assert_product(p_product_id,private.inventory_permission(p_type));
 PERFORM private.inventory_validate_note(p_reason,p_reference);
 IF p_request_id IS NULL OR p_delta IS NULL OR p_delta=0 OR p_delta NOT BETWEEN -1000000000 AND 1000000000 THEN
  RAISE EXCEPTION 'INVALID_MOVEMENT_QUANTITY_OR_REQUEST' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.inventory_balances(product_id,store_id) VALUES(p_product_id,s) ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM public.inventory_balances WHERE product_id=p_product_id FOR UPDATE;
 average_before:=b.average_cost;
 IF p_type='REVERSAL' THEN
  SELECT * INTO original FROM public.inventory_movements WHERE id=p_reversal_of_id AND product_id=p_product_id;
  IF NOT FOUND OR original.movement_type='REVERSAL' THEN
   RAISE EXCEPTION 'INVALID_REVERSAL_SOURCE' USING ERRCODE = '22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.inventory_movements WHERE reversal_of_id=original.id) THEN
   RAISE EXCEPTION 'MOVEMENT_ALREADY_REVERSED' USING ERRCODE = '22023'; END IF;
  IF b.last_movement_id IS DISTINCT FROM original.id THEN
   RAISE EXCEPTION 'ONLY_LAST_MOVEMENT_CAN_BE_REVERSED' USING ERRCODE = '22023'; END IF;
  IF p_delta<>-original.quantity_delta THEN RAISE EXCEPTION 'INVALID_REVERSAL_DELTA' USING ERRCODE = '22023'; END IF;
  q:=original.quantity_before;
  value_change:=-original.value_delta;
  value_after:=original.value_before;
  cost:=original.unit_cost;
 ELSE
  IF p_reversal_of_id IS NOT NULL THEN RAISE EXCEPTION 'UNEXPECTED_REVERSAL_SOURCE' USING ERRCODE = '22023'; END IF;
  q:=b.quantity::bigint+p_delta::bigint;
  IF q<0 THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING ERRCODE = '22023'; END IF;
  IF q>1000000000 THEN RAISE EXCEPTION 'STOCK_QUANTITY_LIMIT' USING ERRCODE = '22023'; END IF;
  IF p_delta>0 THEN
   IF p_type NOT IN ('ENTRY','ADJUSTMENT_IN') THEN RAISE EXCEPTION 'INVALID_MOVEMENT_SIGN' USING ERRCODE = '22023'; END IF;
   IF p_unit_cost IS NULL AND p_type='ADJUSTMENT_IN' AND b.quantity>0 THEN
    value_change:=round(b.stock_value*p_delta/b.quantity,6);
    cost:=round(value_change/p_delta,6);
   ELSE
    PERFORM private.inventory_validate_unit_cost(p_unit_cost);
    value_change:=round(p_delta::numeric*p_unit_cost,6); cost:=p_unit_cost;
   END IF;
  ELSE
   IF p_type NOT IN ('EXIT','ADJUSTMENT_OUT') THEN RAISE EXCEPTION 'INVALID_MOVEMENT_SIGN' USING ERRCODE = '22023'; END IF;
   IF p_unit_cost IS NOT NULL THEN RAISE EXCEPTION 'OUTBOUND_COST_IS_AUTOMATIC' USING ERRCODE = '22023'; END IF;
   IF q=0 THEN value_change:=-b.stock_value;
   ELSE value_change:=-round(b.stock_value*abs(p_delta::bigint)/b.quantity,6); END IF;
   cost:=round(abs(value_change)/abs(p_delta::bigint),6);
  END IF;
  value_after:=b.stock_value+value_change;
 END IF;
 average_after:=CASE WHEN q=0 THEN 0 ELSE round(value_after/q,6) END;
 INSERT INTO public.inventory_movements(store_id,product_id,product_code,product_name,request_id,batch_request_id,
  movement_type,quantity_delta,unit_cost,value_delta,quantity_before,quantity_after,value_before,value_after,
  average_cost_before,average_cost_after,revision,reason,reference,reversal_of_id,created_by)
 VALUES(s,p_product_id,'','',p_request_id,p_batch_request_id,p_type,p_delta,cost,value_change,b.quantity,q::integer,
  b.stock_value,value_after,average_before,average_after,b.revision+1,btrim(p_reason),NULLIF(btrim(p_reference),''),p_reversal_of_id,auth.uid())
 RETURNING * INTO m;
 -- AFTER INSERT aplica automaticamente a projecao na mesma transacao.
 RETURN jsonb_build_object('movement_id',m.id,'product_id',m.product_id,'movement_type',m.movement_type,
  'quantity_delta',m.quantity_delta,'quantity',m.quantity_after,'stock_value',m.value_after,
  'average_cost',m.average_cost_after,'revision',m.revision,'replayed',false);
END;
$$;

CREATE FUNCTION public.register_inventory_movement(
 p_product_id uuid,p_request_id uuid,p_type text,p_quantity integer,
 p_reason text,p_unit_cost numeric DEFAULT NULL,p_reference text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; t public.inventory_movement_type; payload jsonb; result jsonb;
BEGIN
 IF p_type IS NULL OR p_type NOT IN ('ENTRY','EXIT') THEN
  RAISE EXCEPTION 'MANUAL_TYPE_MUST_BE_ENTRY_OR_EXIT' USING ERRCODE = '22023'; END IF;
 t:=p_type::public.inventory_movement_type;
 s:=private.inventory_assert_product(p_product_id,private.inventory_permission(t));
 PERFORM private.inventory_validate_note(p_reason,p_reference);
 IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000000000 THEN
  RAISE EXCEPTION 'QUANTITY_MUST_BE_POSITIVE_INTEGER' USING ERRCODE = '22023'; END IF;
 IF t='ENTRY' THEN PERFORM private.inventory_validate_unit_cost(p_unit_cost);
 ELSIF p_unit_cost IS NOT NULL THEN RAISE EXCEPTION 'OUTBOUND_COST_IS_AUTOMATIC' USING ERRCODE = '22023'; END IF;
 payload:=jsonb_build_object('operation','movement','product_id',p_product_id,'type',t,'quantity',p_quantity,
  'unit_cost',p_unit_cost,'reason',btrim(p_reason),'reference',NULLIF(btrim(p_reference),''));
 result:=private.inventory_cached_request(s,p_request_id,payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 result:=private.post_inventory_movement(p_product_id,p_request_id,t,
  CASE WHEN t='ENTRY' THEN p_quantity ELSE -p_quantity END,p_unit_cost,p_reason,p_reference);
 INSERT INTO private.inventory_requests(store_id,request_id,payload,result) VALUES(s,p_request_id,payload,result);
 RETURN result;
END;
$$;

CREATE FUNCTION public.adjust_inventory_count(
 p_product_id uuid,p_request_id uuid,p_counted_quantity integer,p_expected_revision bigint,
 p_reason text,p_unit_cost numeric DEFAULT NULL,p_reference text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; b public.inventory_balances%ROWTYPE; payload jsonb; result jsonb; delta integer;
BEGIN
 s:=private.inventory_assert_product(p_product_id,'inventory.adjust');
 PERFORM private.inventory_validate_note(p_reason,p_reference);
 IF p_counted_quantity IS NULL OR p_counted_quantity NOT BETWEEN 0 AND 1000000000
 OR p_expected_revision IS NULL OR p_expected_revision<0 THEN
  RAISE EXCEPTION 'INVALID_COUNT_OR_EXPECTED_REVISION' USING ERRCODE = '22023'; END IF;
 IF p_unit_cost IS NOT NULL THEN PERFORM private.inventory_validate_unit_cost(p_unit_cost); END IF;
 payload:=jsonb_build_object('operation','count','product_id',p_product_id,'counted_quantity',p_counted_quantity,
  'expected_revision',p_expected_revision,'unit_cost',p_unit_cost,'reason',btrim(p_reason),'reference',NULLIF(btrim(p_reference),''));
 result:=private.inventory_cached_request(s,p_request_id,payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 INSERT INTO public.inventory_balances(product_id,store_id) VALUES(p_product_id,s) ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM public.inventory_balances WHERE product_id=p_product_id FOR UPDATE;
 IF b.revision<>p_expected_revision THEN RAISE EXCEPTION 'STALE_INVENTORY_REVISION' USING ERRCODE = '22023'; END IF;
 delta:=p_counted_quantity-b.quantity;
 IF delta<=0 AND p_unit_cost IS NOT NULL THEN RAISE EXCEPTION 'UNIT_COST_NOT_ALLOWED_FOR_OUTBOUND_OR_NO_CHANGE' USING ERRCODE = '22023'; END IF;
 IF delta=0 THEN
  result:=jsonb_build_object('product_id',p_product_id,'quantity',b.quantity,'stock_value',b.stock_value,
   'average_cost',b.average_cost,'revision',b.revision,'changed',false,'replayed',false);
 ELSE
  result:=private.post_inventory_movement(p_product_id,p_request_id,
   CASE WHEN delta>0 THEN 'ADJUSTMENT_IN'::public.inventory_movement_type ELSE 'ADJUSTMENT_OUT'::public.inventory_movement_type END,
   delta,p_unit_cost,p_reason,p_reference) || '{"changed":true}'::jsonb;
 END IF;
 INSERT INTO private.inventory_requests(store_id,request_id,payload,result) VALUES(s,p_request_id,payload,result);
 RETURN result;
END;
$$;

CREATE FUNCTION public.reverse_inventory_movement(p_movement_id uuid,p_request_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.inventory_movements%ROWTYPE; s uuid; payload jsonb; result jsonb;
BEGIN
 SELECT * INTO m FROM public.inventory_movements WHERE id=p_movement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
 s:=private.inventory_assert_product(m.product_id,'inventory.reverse');
 PERFORM private.inventory_validate_note(p_reason,NULL);
 payload:=jsonb_build_object('operation','reverse','movement_id',p_movement_id,'reason',btrim(p_reason));
 result:=private.inventory_cached_request(s,p_request_id,payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 result:=private.post_inventory_movement(m.product_id,p_request_id,'REVERSAL',-m.quantity_delta,NULL,
  p_reason,m.reference,NULL,m.id);
 INSERT INTO private.inventory_requests(store_id,request_id,payload,result) VALUES(s,p_request_id,payload,result);
 RETURN result;
END;
$$;


CREATE FUNCTION public.adjust_inventory_batch(
 p_store_id uuid,p_request_id uuid,p_items jsonb,p_reason text,p_reference text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE normalized jsonb; payload jsonb; result jsonb; items_result jsonb:='[]'::jsonb;
 item jsonb; p public.products%ROWTYPE; b public.inventory_balances%ROWTYPE;
 delta integer; cost numeric; one_result jsonb; child_request uuid;
BEGIN
 PERFORM private.lock_catalog_store(p_store_id,'inventory.adjust');
 PERFORM private.inventory_validate_note(p_reason,p_reference);
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN
  RAISE EXCEPTION 'BATCH_ITEMS_ARRAY_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR pg_column_size(p_items)>32768 THEN
  RAISE EXCEPTION 'BATCH_LIMIT_50' USING ERRCODE = '22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e(row) WHERE jsonb_typeof(e.row)<>'object') THEN
  RAISE EXCEPTION 'INVALID_BATCH_ITEM' USING ERRCODE = '22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e(row) CROSS JOIN LATERAL jsonb_object_keys(e.row) k(key)
  WHERE k.key NOT IN ('product_id','counted_quantity','expected_revision','unit_cost')) THEN
  RAISE EXCEPTION 'UNKNOWN_BATCH_FIELD' USING ERRCODE = '22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) e(row)
  WHERE jsonb_typeof(e.row -> 'product_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(e.row -> 'counted_quantity') IS DISTINCT FROM 'number'
   OR jsonb_typeof(e.row -> 'expected_revision') IS DISTINCT FROM 'number'
   OR (e.row ? 'unit_cost' AND jsonb_typeof(e.row -> 'unit_cost') NOT IN ('number','null'))) THEN
  RAISE EXCEPTION 'INVALID_BATCH_FIELD_TYPE' USING ERRCODE = '22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',(e.row ->> 'product_id')::uuid,
  'counted_quantity',(e.row ->> 'counted_quantity')::integer,
  'expected_revision',(e.row ->> 'expected_revision')::bigint,
  'unit_cost',(e.row ->> 'unit_cost')::numeric) ORDER BY e.pos)
 INTO normalized FROM jsonb_array_elements(p_items) WITH ORDINALITY e(row,pos);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) e(row)
  GROUP BY e.row ->> 'product_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'BATCH_DUPLICATE_PRODUCT' USING ERRCODE = '22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) e(row)
  WHERE (e.row ->> 'counted_quantity')::integer NOT BETWEEN 0 AND 1000000000
   OR (e.row ->> 'expected_revision')::bigint<0) THEN
  RAISE EXCEPTION 'INVALID_COUNT_OR_EXPECTED_REVISION' USING ERRCODE = '22023'; END IF;
 payload:=jsonb_build_object('operation','batch_count','items',normalized,
  'reason',btrim(p_reason),'reference',NULLIF(btrim(p_reference),''));
 result:=private.inventory_cached_request(p_store_id,p_request_id,payload);
 IF result IS NOT NULL THEN RETURN result; END IF;
 FOR item IN SELECT e.row FROM jsonb_array_elements(normalized) e(row) ORDER BY (e.row ->> 'product_id')::uuid LOOP
  SELECT * INTO p FROM public.products WHERE id=(item ->> 'product_id')::uuid AND store_id=p_store_id AND archived_at IS NULL;
  IF NOT FOUND OR NOT private.catalog_product_allowed(p.id,'inventory.adjust') THEN
   RAISE EXCEPTION 'BATCH_PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.inventory_balances(product_id,store_id) VALUES(p.id,p_store_id) ON CONFLICT DO NOTHING;
  SELECT * INTO b FROM public.inventory_balances WHERE product_id=p.id FOR UPDATE;
  IF b.revision<>(item ->> 'expected_revision')::bigint THEN
   RAISE EXCEPTION 'STALE_INVENTORY_REVISION' USING ERRCODE = '22023'; END IF;
  cost:=(item ->> 'unit_cost')::numeric;
  IF cost IS NOT NULL THEN PERFORM private.inventory_validate_unit_cost(cost); END IF;
  delta:=(item ->> 'counted_quantity')::integer-b.quantity;
  IF delta<=0 AND cost IS NOT NULL THEN
   RAISE EXCEPTION 'UNIT_COST_NOT_ALLOWED_FOR_OUTBOUND_OR_NO_CHANGE' USING ERRCODE = '22023'; END IF;
  IF delta=0 THEN
   one_result:=jsonb_build_object('product_id',p.id,'quantity',b.quantity,'stock_value',b.stock_value,
    'average_cost',b.average_cost,'revision',b.revision,'changed',false);
  ELSE
   child_request:=gen_random_uuid();
   one_result:=private.post_inventory_movement(p.id,child_request,
    CASE WHEN delta>0 THEN 'ADJUSTMENT_IN'::public.inventory_movement_type ELSE 'ADJUSTMENT_OUT'::public.inventory_movement_type END,
    delta,cost,p_reason,p_reference,p_request_id) || '{"changed":true}'::jsonb;
  END IF;
  items_result:=items_result || jsonb_build_array(one_result);
 END LOOP;
 result:=jsonb_build_object('store_id',p_store_id,'request_id',p_request_id,'items',items_result,'replayed',false);
 INSERT INTO private.inventory_requests(store_id,request_id,payload,result) VALUES(p_store_id,p_request_id,payload,result);
 RETURN result;
END;
$$;

CREATE TRIGGER inventory_movements_audit AFTER INSERT ON public.inventory_movements
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER inventory_requests_audit AFTER INSERT ON private.inventory_requests
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();

REVOKE ALL ON FUNCTION private.inventory_permission(public.inventory_movement_type),
 private.guard_inventory_ledger(),private.guard_inventory_projection(),private.apply_inventory_movement(),
 private.prevent_archive_with_stock(),private.inventory_assert_product(uuid,text),
 private.inventory_validate_note(text,text),private.inventory_validate_unit_cost(numeric),
 private.inventory_cached_request(uuid,uuid,jsonb),
 private.post_inventory_movement(uuid,uuid,public.inventory_movement_type,integer,numeric,text,text,uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.register_inventory_movement(uuid,uuid,text,integer,text,numeric,text),
 public.adjust_inventory_count(uuid,uuid,integer,bigint,text,numeric,text),
 public.reverse_inventory_movement(uuid,uuid,text),public.adjust_inventory_batch(uuid,uuid,jsonb,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_inventory_movement(uuid,uuid,text,integer,text,numeric,text),
 public.adjust_inventory_count(uuid,uuid,integer,bigint,text,numeric,text),
 public.reverse_inventory_movement(uuid,uuid,text),public.adjust_inventory_batch(uuid,uuid,jsonb,text,text)
 TO authenticated;
COMMIT;
