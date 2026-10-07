-- VibeStore / Modulo 06: operacao MANUAL dos pedidos
-- Dependencias: migrations 001..005. Nenhum gateway, pagamento automatico ou frontend.
-- Devolucoes/reembolsos totais, quantidades inteiras, um recebimento e um estorno por pedido.
BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.orders WHERE status<>'PENDING') THEN
  RAISE EXCEPTION 'PREEXISTING_ORDER_STATE_REQUIRES_RECONCILIATION'; END IF;
END; $$;
ALTER TABLE public.orders ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE public.orders ADD COLUMN shipping_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(shipping_amount>=0 AND shipping_amount<>'NaN'::numeric);
ALTER TABLE public.orders ADD COLUMN shipping_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.orders ADD COLUMN tracking_code text CHECK(tracking_code IS NULL OR char_length(tracking_code)<=120);
ALTER TABLE public.orders ADD COLUMN paid_at timestamptz;
ALTER TABLE public.orders ADD COLUMN shipped_at timestamptz;
ALTER TABLE public.orders ADD COLUMN delivered_at timestamptz;
ALTER TABLE public.orders ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.orders ADD COLUMN returned_at timestamptz;
-- A constraint automatica de total=subtotal do modulo 05 passa a incluir frete manual.
ALTER TABLE public.orders DROP CONSTRAINT orders_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_total_calculation CHECK(total=subtotal+shipping_amount AND total>=0 AND total<>'NaN'::numeric);
ALTER TABLE public.order_items ADD CONSTRAINT order_items_order_identity UNIQUE(id,order_id,store_id);

-- ON CONFLICT DO NOTHING tambem dispara BEFORE INSERT. Nao validar o saldo zero
-- da linha candidata quando a projecao existente sera mantida integralmente.
CREATE OR REPLACE FUNCTION private.guard_stock_against_reservations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=NEW.product_id) THEN RETURN NEW;END IF;
 IF NEW.quantity<private.active_reserved_quantity(NEW.product_id) THEN
  RAISE EXCEPTION 'STOCK_RESERVED_BY_PENDING_ORDERS' USING ERRCODE='22023';END IF;
 RETURN NEW;
END; $$;

CREATE TABLE public.order_status_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,order_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>=0),event_type text NOT NULL CHECK(event_type IN
 ('CREATED','TERMS_UPDATED','PAYMENT_CONFIRMED','SHIPPED','DELIVERED','CANCELLED','RETURNED')),
 status_before public.order_status,status_after public.order_status NOT NULL,
 note text NOT NULL CHECK(char_length(note)<=1000),actor_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT order_history_order FOREIGN KEY(order_id,store_id) REFERENCES public.orders(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_history_revision UNIQUE(order_id,revision)
);
CREATE INDEX order_status_history_store_idx ON public.order_status_history(store_id,order_id,revision);
CREATE TABLE public.order_payments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,order_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('RECEIPT','REFUND')),
 method text NOT NULL CHECK(method IN('PIX','CASH','BANK_TRANSFER','CARD','OTHER')),
 amount numeric(12,2) NOT NULL CHECK(amount>=0 AND amount<>'NaN'::numeric),
 external_reference text CHECK(external_reference IS NULL OR char_length(external_reference)<=160),
 note text NOT NULL CHECK(char_length(btrim(note)) BETWEEN 3 AND 1000),
 confirmed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 confirmed_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 CONSTRAINT order_payments_order FOREIGN KEY(order_id,store_id) REFERENCES public.orders(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_payments_kind UNIQUE(order_id,kind)
);
CREATE INDEX order_payments_store_idx ON public.order_payments(store_id,confirmed_at DESC,id);
COMMENT ON TABLE public.order_payments IS 'Declaracao MANUAL de recebimento/estorno. Nao confirma transacao bancaria nem aciona gateway.';
CREATE TABLE public.order_stock_operations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,order_id uuid NOT NULL,order_item_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('SALE','RESTOCK')),
 movement_id uuid NOT NULL UNIQUE REFERENCES public.inventory_movements(id) ON DELETE RESTRICT,
 quantity integer NOT NULL CHECK(quantity>0),allocated_value numeric(26,6) NOT NULL CHECK(allocated_value>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT order_stock_item FOREIGN KEY(order_item_id,order_id,store_id) REFERENCES public.order_items(id,order_id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_stock_kind UNIQUE(order_item_id,kind)
);
CREATE INDEX order_stock_operations_store_idx ON public.order_stock_operations(store_id,order_id);
CREATE TABLE public.order_return_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,order_id uuid NOT NULL,order_item_id uuid NOT NULL,
 disposition text NOT NULL CHECK(disposition IN('RESTOCKED','DAMAGED')),
 quantity integer NOT NULL CHECK(quantity>0),allocated_cost numeric(26,6) NOT NULL CHECK(allocated_cost>=0),
 restocked_value numeric(26,6) NOT NULL CHECK(restocked_value>=0),loss_value numeric(26,6) NOT NULL CHECK(loss_value>=0),
 note text NOT NULL CHECK(char_length(note)<=1000),created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT order_return_item FOREIGN KEY(order_item_id,order_id,store_id) REFERENCES public.order_items(id,order_id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_return_unique UNIQUE(order_item_id),
 CONSTRAINT order_return_cost CHECK(allocated_cost=restocked_value+loss_value)
);
CREATE TABLE private.order_operation_requests(
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,request_id uuid NOT NULL,
 payload jsonb NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(store_id,request_id)
);
REVOKE ALL ON private.order_operation_requests FROM PUBLIC,anon,authenticated;

ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions(code,module,description,is_system) VALUES
 ('orders.terms','orders','Confirmar frete manual antes do pagamento.',true),
 ('orders.pay','orders','Confirmar recebimento manual e baixar estoque.',true),
 ('orders.ship','orders','Registrar envio de pedido pago.',true),
 ('orders.deliver','orders','Registrar entrega de pedido enviado.',true),
 ('orders.cancel','orders','Cancelar pendente ou pago ainda nao enviado.',true),
 ('orders.return','orders','Receber devolucao total e registrar reembolso manual.',true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;
INSERT INTO public.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN('OWNER','SUDO') AND p.code IN('orders.terms','orders.pay','orders.ship','orders.deliver','orders.cancel','orders.return');

CREATE FUNCTION private.order_event_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.order_status_history(store_id,order_id,revision,event_type,status_after,note,request_id,created_at)
 VALUES(NEW.store_id,NEW.id,NEW.revision,'CREATED',NEW.status,'Pedido criado pelo checkout publico',NEW.request_id,NEW.created_at);
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_created_history AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION private.order_event_created();
INSERT INTO public.order_status_history(store_id,order_id,revision,event_type,status_after,note,request_id,created_at)
SELECT store_id,id,revision,'CREATED',status,'Pedido anterior ao modulo 06',request_id,created_at FROM public.orders;

CREATE FUNCTION private.immutable_order_record()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'ORDER_RECORD_IMMUTABLE' USING ERRCODE='42501';END; $$;
CREATE TRIGGER order_payments_immutable BEFORE UPDATE OR DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.immutable_order_record();
CREATE TRIGGER order_history_immutable BEFORE UPDATE OR DELETE ON public.order_status_history FOR EACH ROW EXECUTE FUNCTION private.immutable_order_record();
CREATE TRIGGER order_stock_immutable BEFORE UPDATE OR DELETE ON public.order_stock_operations FOR EACH ROW EXECUTE FUNCTION private.immutable_order_record();
CREATE TRIGGER order_return_immutable BEFORE UPDATE OR DELETE ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION private.immutable_order_record();

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_stock_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_return_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_status_history,public.order_payments,public.order_stock_operations,public.order_return_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_status_history,public.order_payments,public.order_stock_operations,public.order_return_items TO authenticated,service_role;
CREATE POLICY order_history_read ON public.order_status_history FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));
CREATE POLICY order_payments_read ON public.order_payments FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));
CREATE POLICY order_stock_read ON public.order_stock_operations FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));
CREATE POLICY order_return_read ON public.order_return_items FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));

CREATE FUNCTION private.lock_order(p_order_id uuid,p_permission text)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT FOUND OR NOT private.catalog_store_allowed(o.store_id,p_permission) THEN
  RAISE EXCEPTION 'ORDER_FORBIDDEN' USING ERRCODE='42501';END IF;
 PERFORM private.lock_catalog_store(o.store_id,p_permission);
 SELECT * INTO o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT private.catalog_store_allowed(o.store_id,p_permission) THEN RAISE EXCEPTION 'ORDER_FORBIDDEN' USING ERRCODE='42501';END IF;
 RETURN o;
END; $$;
CREATE FUNCTION private.order_cached_request(p_store_id uuid,p_request_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r private.order_operation_requests%ROWTYPE;
BEGIN
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_REQUIRED' USING ERRCODE='22004';END IF;
 SELECT * INTO r FROM private.order_operation_requests WHERE store_id=p_store_id AND request_id=p_request_id;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='22023';END IF;
  RETURN r.result||'{"replayed":true}'::jsonb;
 END IF;RETURN NULL;
END; $$;
CREATE FUNCTION private.validate_order_note(p_note text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF p_note IS NULL OR char_length(btrim(p_note)) NOT BETWEEN 3 AND 1000 THEN
 RAISE EXCEPTION 'ORDER_NOTE_REQUIRED' USING ERRCODE='22023';END IF;END; $$;
CREATE FUNCTION private.validate_manual_method(p_method text,p_reference text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN IF p_method IS NULL OR p_method NOT IN('PIX','CASH','BANK_TRANSFER','CARD','OTHER')
 OR(p_reference IS NOT NULL AND char_length(p_reference)>160) THEN RAISE EXCEPTION 'INVALID_MANUAL_PAYMENT_METHOD' USING ERRCODE='22023';END IF;END; $$;
CREATE FUNCTION private.check_order_revision(p_order_id uuid,p_expected bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN IF p_expected IS NULL OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=p_order_id AND revision=p_expected) THEN
 RAISE EXCEPTION 'STALE_ORDER_REVISION' USING ERRCODE='22023';END IF;END; $$;
CREATE FUNCTION private.finish_order_operation(p_order_id uuid,p_request_id uuid,p_payload jsonb,p_event text,p_before public.order_status,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;r jsonb;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 INSERT INTO public.order_status_history(store_id,order_id,revision,event_type,status_before,status_after,note,actor_id,request_id)
 VALUES(o.store_id,o.id,o.revision,p_event,p_before,o.status,btrim(p_note),auth.uid(),p_request_id);
 r:=jsonb_build_object('order_id',o.id,'status',o.status,'revision',o.revision,'subtotal',o.subtotal,
  'shipping_amount',o.shipping_amount,'shipping_confirmed',o.shipping_confirmed,'total',o.total,'replayed',false);
 INSERT INTO private.order_operation_requests(store_id,request_id,payload,result) VALUES(o.store_id,p_request_id,p_payload,r);
 RETURN r;
END; $$;


CREATE FUNCTION public.update_order_terms(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_shipping_amount numeric,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;
BEGIN
 o:=private.lock_order(p_order_id,'orders.terms');PERFORM private.validate_order_note(p_note);
 IF p_shipping_amount IS NULL OR p_shipping_amount='NaN'::numeric OR p_shipping_amount<0
 OR p_shipping_amount>9999999999.99 OR p_shipping_amount<>round(p_shipping_amount,2) THEN
  RAISE EXCEPTION 'INVALID_SHIPPING_AMOUNT' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','terms','order_id',p_order_id,'expected_revision',p_expected_revision,
  'shipping_amount',p_shipping_amount,'note',btrim(p_note));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status<>'PENDING' THEN RAISE EXCEPTION 'ORDER_NOT_PENDING' USING ERRCODE='22023';END IF;
 IF o.subtotal+p_shipping_amount>9999999999.99 THEN RAISE EXCEPTION 'ORDER_TOTAL_LIMIT' USING ERRCODE='22023';END IF;
 UPDATE public.orders SET shipping_amount=p_shipping_amount,shipping_confirmed=true,total=subtotal+p_shipping_amount,
  revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'TERMS_UPDATED',o.status,p_note);
END; $$;

CREATE FUNCTION public.confirm_order_payment(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_amount numeric,
 p_method text,p_note text,p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;item public.order_items%ROWTYPE;
 m public.inventory_movements%ROWTYPE;available integer;
BEGIN
 o:=private.lock_order(p_order_id,'orders.pay');PERFORM private.validate_order_note(p_note);
 PERFORM private.validate_manual_method(p_method,p_reference);
 payload:=jsonb_build_object('operation','pay','order_id',o.id,'expected_revision',p_expected_revision,'amount',p_amount,
  'method',p_method,'note',btrim(p_note),'reference',NULLIF(btrim(p_reference),''));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status<>'PENDING' THEN RAISE EXCEPTION 'ORDER_NOT_PENDING' USING ERRCODE='22023';END IF;
 IF NOT o.shipping_confirmed THEN RAISE EXCEPTION 'SHIPPING_TERMS_NOT_CONFIRMED' USING ERRCODE='22023';END IF;
 IF p_amount IS NULL OR p_amount<>o.total THEN RAISE EXCEPTION 'PAYMENT_MUST_MATCH_ORDER_TOTAL' USING ERRCODE='22023';END IF;
 -- Libera apenas a propria reserva. A mudanca sera revertida se algum item falhar.
 UPDATE public.inventory_reservations SET state='CONSUMED' WHERE order_id=o.id AND state='HELD';
 FOR item IN SELECT * FROM public.order_items WHERE order_id=o.id ORDER BY product_id LOOP
  PERFORM private.inventory_assert_product(item.product_id,'inventory.exit');
  SELECT COALESCE((SELECT quantity FROM public.inventory_balances WHERE product_id=item.product_id),0)
   -private.active_reserved_quantity(item.product_id) INTO available;
  IF available<item.quantity THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_STOCK_FOR_PAYMENT' USING ERRCODE='22023';END IF;
  r:=private.post_inventory_movement(item.product_id,gen_random_uuid(),'EXIT',-item.quantity,NULL,
   'Baixa por pagamento manual do pedido '||o.code,o.code);
  SELECT * INTO m FROM public.inventory_movements WHERE id=(r ->> 'movement_id')::uuid;
  INSERT INTO public.order_stock_operations(store_id,order_id,order_item_id,kind,movement_id,quantity,allocated_value)
  VALUES(o.store_id,o.id,item.id,'SALE',m.id,item.quantity,abs(m.value_delta));
 END LOOP;
 INSERT INTO public.order_payments(store_id,order_id,kind,method,amount,external_reference,note,confirmed_by,request_id)
 VALUES(o.store_id,o.id,'RECEIPT',p_method,o.total,NULLIF(btrim(p_reference),''),btrim(p_note),auth.uid(),p_request_id);
 UPDATE public.orders SET status='PAID',paid_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'PAYMENT_CONFIRMED',o.status,p_note);
END; $$;

CREATE FUNCTION public.ship_order(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_note text,p_tracking_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;
BEGIN
 o:=private.lock_order(p_order_id,'orders.ship');PERFORM private.validate_order_note(p_note);
 IF p_tracking_code IS NOT NULL AND char_length(p_tracking_code)>120 THEN RAISE EXCEPTION 'INVALID_TRACKING_CODE' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','ship','order_id',o.id,'expected_revision',p_expected_revision,
  'tracking_code',NULLIF(btrim(p_tracking_code),''),'note',btrim(p_note));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status<>'PAID' THEN RAISE EXCEPTION 'ORDER_NOT_PAID' USING ERRCODE='22023';END IF;
 UPDATE public.orders SET status='SHIPPED',tracking_code=NULLIF(btrim(p_tracking_code),''),shipped_at=clock_timestamp(),
  revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'SHIPPED',o.status,p_note);
END; $$;

CREATE FUNCTION public.deliver_order(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;
BEGIN
 o:=private.lock_order(p_order_id,'orders.deliver');PERFORM private.validate_order_note(p_note);
 payload:=jsonb_build_object('operation','deliver','order_id',o.id,'expected_revision',p_expected_revision,'note',btrim(p_note));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status<>'SHIPPED' THEN RAISE EXCEPTION 'ORDER_NOT_SHIPPED' USING ERRCODE='22023';END IF;
 UPDATE public.orders SET status='DELIVERED',delivered_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'DELIVERED',o.status,p_note);
END; $$;

-- Reposicao usa o valor EXATO alocado na saida original, sem multiplicar custo medio arredondado.
CREATE FUNCTION private.restore_order_item_stock(p_order_item_id uuid,p_reason text)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.order_items%ROWTYPE;source public.order_stock_operations%ROWTYPE;
 b public.inventory_balances%ROWTYPE;m public.inventory_movements%ROWTYPE;o public.orders%ROWTYPE;
 q bigint;cost numeric;v_after numeric;
BEGIN
 SELECT * INTO item FROM public.order_items WHERE id=p_order_item_id;
 SELECT * INTO source FROM public.order_stock_operations WHERE order_item_id=item.id AND kind='SALE';
 IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_SALE_ALLOCATION_MISSING' USING ERRCODE='22023';END IF;
 SELECT * INTO o FROM public.orders WHERE id=item.order_id;
 PERFORM private.inventory_assert_product(item.product_id,'inventory.entry');
 SELECT * INTO b FROM public.inventory_balances WHERE product_id=item.product_id FOR UPDATE;
 q:=b.quantity::bigint+item.quantity;
 IF q>1000000000 THEN RAISE EXCEPTION 'STOCK_QUANTITY_LIMIT' USING ERRCODE='22023';END IF;
 v_after:=b.stock_value+source.allocated_value;cost:=round(source.allocated_value/item.quantity,6);
 INSERT INTO public.inventory_movements(store_id,product_id,product_code,product_name,request_id,movement_type,
  quantity_delta,unit_cost,value_delta,quantity_before,quantity_after,value_before,value_after,
  average_cost_before,average_cost_after,revision,reason,reference,created_by)
 VALUES(item.store_id,item.product_id,'','',gen_random_uuid(),'ENTRY',item.quantity,cost,source.allocated_value,
  b.quantity,q::integer,b.stock_value,v_after,b.average_cost,round(v_after/q,6),b.revision+1,p_reason,o.code,auth.uid())
 RETURNING * INTO m;
 INSERT INTO public.order_stock_operations(store_id,order_id,order_item_id,kind,movement_id,quantity,allocated_value)
 VALUES(item.store_id,item.order_id,item.id,'RESTOCK',m.id,item.quantity,source.allocated_value);
 RETURN source.allocated_value;
END; $$;

CREATE FUNCTION private.record_manual_refund(p_order_id uuid,p_request_id uuid,p_method text,p_reference text,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
 PERFORM private.validate_manual_method(p_method,p_reference);
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF NOT EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o.id AND kind='RECEIPT' AND amount=o.total) THEN
  RAISE EXCEPTION 'ORDER_RECEIPT_MISSING' USING ERRCODE='22023';END IF;
 INSERT INTO public.order_payments(store_id,order_id,kind,method,amount,external_reference,note,confirmed_by,request_id)
 VALUES(o.store_id,o.id,'REFUND',p_method,o.total,NULLIF(btrim(p_reference),''),btrim(p_note),auth.uid(),p_request_id);
END; $$;

CREATE FUNCTION public.cancel_order(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_note text,
 p_refund_confirmed boolean DEFAULT false,p_refund_method text DEFAULT NULL,p_refund_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;item public.order_items%ROWTYPE;
BEGIN
 o:=private.lock_order(p_order_id,'orders.cancel');PERFORM private.validate_order_note(p_note);
 payload:=jsonb_build_object('operation','cancel','order_id',o.id,'expected_revision',p_expected_revision,'note',btrim(p_note),
  'refund_confirmed',p_refund_confirmed,'refund_method',p_refund_method,'refund_reference',NULLIF(btrim(p_refund_reference),''));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status NOT IN('PENDING','PAID') THEN RAISE EXCEPTION 'ORDER_CANNOT_BE_CANCELLED' USING ERRCODE='22023';END IF;
 IF o.status='PENDING' THEN
  IF p_refund_confirmed IS DISTINCT FROM false OR p_refund_method IS NOT NULL OR p_refund_reference IS NOT NULL THEN
   RAISE EXCEPTION 'UNEXPECTED_REFUND_FOR_UNPAID_ORDER' USING ERRCODE='22023';END IF;
  UPDATE public.inventory_reservations SET state='RELEASED' WHERE order_id=o.id AND state='HELD';
 ELSE
  IF p_refund_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANUAL_REFUND_CONFIRMATION_REQUIRED' USING ERRCODE='22023';END IF;
  PERFORM private.record_manual_refund(o.id,p_request_id,p_refund_method,p_refund_reference,p_note);
  FOR item IN SELECT * FROM public.order_items WHERE order_id=o.id ORDER BY product_id LOOP
   PERFORM private.restore_order_item_stock(item.id,'Reposicao por cancelamento do pedido '||o.code);
  END LOOP;
 END IF;
 UPDATE public.orders SET status='CANCELLED',cancelled_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'CANCELLED',o.status,p_note);
END; $$;


CREATE FUNCTION public.return_order(p_order_id uuid,p_request_id uuid,p_expected_revision bigint,p_items jsonb,
 p_goods_received boolean,p_refund_confirmed boolean,p_refund_method text,p_note text,p_refund_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;payload jsonb;r jsonb;rows jsonb;row jsonb;
 item public.order_items%ROWTYPE;source public.order_stock_operations%ROWTYPE;restocked numeric;
BEGIN
 o:=private.lock_order(p_order_id,'orders.return');PERFORM private.validate_order_note(p_note);
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN RAISE EXCEPTION 'RETURN_ITEMS_REQUIRED' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 OR pg_column_size(p_items)>32768 THEN RAISE EXCEPTION 'INVALID_RETURN_ITEMS' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items)e(row) WHERE jsonb_typeof(e.row)<>'object') THEN RAISE EXCEPTION 'INVALID_RETURN_ITEM' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items)e(row) CROSS JOIN LATERAL jsonb_object_keys(e.row)k(key)
  WHERE k.key NOT IN('order_item_id','disposition')) THEN RAISE EXCEPTION 'UNKNOWN_RETURN_ITEM_FIELD' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items)e(row)
  WHERE jsonb_typeof(e.row -> 'order_item_id') IS DISTINCT FROM 'string' OR jsonb_typeof(e.row -> 'disposition') IS DISTINCT FROM 'string'
  OR e.row ->> 'disposition' NOT IN('RESTOCKED','DAMAGED')) THEN RAISE EXCEPTION 'INVALID_RETURN_DISPOSITION' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('order_item_id',(e.row ->> 'order_item_id')::uuid,'disposition',e.row ->> 'disposition')
  ORDER BY(e.row ->> 'order_item_id')::uuid) INTO rows FROM jsonb_array_elements(p_items)e(row);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(rows)e(row) GROUP BY e.row ->> 'order_item_id' HAVING count(*)>1)
 OR jsonb_array_length(rows)<>(SELECT count(*) FROM public.order_items WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rows)e(row) WHERE NOT EXISTS(
  SELECT 1 FROM public.order_items i WHERE i.id=(e.row ->> 'order_item_id')::uuid AND i.order_id=o.id)) THEN
  RAISE EXCEPTION 'FULL_ORDER_RETURN_REQUIRED' USING ERRCODE='22023';END IF;
 payload:=jsonb_build_object('operation','return','order_id',o.id,'expected_revision',p_expected_revision,'items',rows,
  'goods_received',p_goods_received,'refund_confirmed',p_refund_confirmed,'refund_method',p_refund_method,
  'note',btrim(p_note),'refund_reference',NULLIF(btrim(p_refund_reference),''));
 r:=private.order_cached_request(o.store_id,p_request_id,payload);IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM private.check_order_revision(o.id,p_expected_revision);
 IF o.status NOT IN('SHIPPED','DELIVERED') THEN RAISE EXCEPTION 'ORDER_CANNOT_BE_RETURNED' USING ERRCODE='22023';END IF;
 IF p_goods_received IS DISTINCT FROM true THEN RAISE EXCEPTION 'PHYSICAL_RETURN_CONFIRMATION_REQUIRED' USING ERRCODE='22023';END IF;
 IF p_refund_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'MANUAL_REFUND_CONFIRMATION_REQUIRED' USING ERRCODE='22023';END IF;
 PERFORM private.record_manual_refund(o.id,p_request_id,p_refund_method,p_refund_reference,p_note);
 FOR row IN SELECT e.row FROM jsonb_array_elements(rows)e(row) ORDER BY(e.row ->> 'order_item_id')::uuid LOOP
  SELECT * INTO item FROM public.order_items WHERE id=(row ->> 'order_item_id')::uuid;
  SELECT * INTO source FROM public.order_stock_operations WHERE order_item_id=item.id AND kind='SALE';
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_SALE_ALLOCATION_MISSING' USING ERRCODE='22023';END IF;
  restocked:=0;
  IF row ->> 'disposition'='RESTOCKED' THEN
   restocked:=private.restore_order_item_stock(item.id,'Reposicao por devolucao do pedido '||o.code);
  END IF;
  INSERT INTO public.order_return_items(store_id,order_id,order_item_id,disposition,quantity,allocated_cost,restocked_value,loss_value,note)
  VALUES(o.store_id,o.id,item.id,row ->> 'disposition',item.quantity,source.allocated_value,restocked,source.allocated_value-restocked,btrim(p_note));
 END LOOP;
 UPDATE public.orders SET status='RETURNED',returned_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=o.id;
 RETURN private.finish_order_operation(o.id,p_request_id,payload,'RETURNED',o.status,p_note);
END; $$;

CREATE FUNCTION private.guard_order_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
 OR NEW.code IS DISTINCT FROM OLD.code OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
 OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
 OR NEW.store_snapshot IS DISTINCT FROM OLD.store_snapshot OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
 OR NEW.customer_note IS DISTINCT FROM OLD.customer_note OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
 OR NEW.reservation_expires_at IS DISTINCT FROM OLD.reservation_expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'ORDER_IDENTITY_AND_SNAPSHOTS_IMMUTABLE' USING ERRCODE='42501';END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'ORDER_REVISION_MUST_ADVANCE' USING ERRCODE='22023';END IF;
 IF OLD.status IN('CANCELLED','RETURNED') THEN RAISE EXCEPTION 'ORDER_TERMINAL' USING ERRCODE='22023';END IF;
 IF OLD.status<>'PENDING' AND(NEW.total IS DISTINCT FROM OLD.total OR NEW.shipping_amount IS DISTINCT FROM OLD.shipping_amount
  OR NEW.shipping_confirmed IS DISTINCT FROM OLD.shipping_confirmed) THEN RAISE EXCEPTION 'PAID_ORDER_TERMS_IMMUTABLE' USING ERRCODE='22023';END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT((OLD.status='PENDING' AND NEW.status IN('PAID','CANCELLED')) OR(OLD.status='PAID' AND NEW.status IN('SHIPPED','CANCELLED'))
   OR(OLD.status='SHIPPED' AND NEW.status IN('DELIVERED','RETURNED')) OR(OLD.status='DELIVERED' AND NEW.status='RETURNED')) THEN
   RAISE EXCEPTION 'INVALID_ORDER_TRANSITION' USING ERRCODE='22023';END IF;
 END IF;
 IF NEW.status='PAID' AND OLD.status='PENDING' THEN
  IF NOT NEW.shipping_confirmed OR NOT EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=NEW.id AND kind='RECEIPT' AND amount=NEW.total)
   OR EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=NEW.id AND NOT EXISTS(
    SELECT 1 FROM public.order_stock_operations s WHERE s.order_item_id=i.id AND s.kind='SALE')) THEN
   RAISE EXCEPTION 'PAID_ORDER_REQUIRES_RECEIPT_AND_STOCK' USING ERRCODE='22023';END IF;
 END IF;
 IF NEW.status='CANCELLED' AND OLD.status='PENDING' AND EXISTS(
  SELECT 1 FROM public.inventory_reservations WHERE order_id=NEW.id AND state='HELD') THEN
   RAISE EXCEPTION 'CANCEL_REQUIRES_RESERVATION_RELEASE' USING ERRCODE='22023';END IF;
 IF NEW.status='CANCELLED' AND OLD.status='PAID' THEN
  IF NOT EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=NEW.id AND kind='REFUND' AND amount=NEW.total)
  OR EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=NEW.id AND NOT EXISTS(
   SELECT 1 FROM public.order_stock_operations s WHERE s.order_item_id=i.id AND s.kind='RESTOCK')) THEN
   RAISE EXCEPTION 'PAID_CANCEL_REQUIRES_REFUND_AND_RESTOCK' USING ERRCODE='22023';END IF;
 END IF;
 IF NEW.status='RETURNED' THEN
  IF NOT EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=NEW.id AND kind='REFUND' AND amount=NEW.total)
  OR EXISTS(SELECT 1 FROM public.order_items i WHERE i.order_id=NEW.id AND NOT EXISTS(
   SELECT 1 FROM public.order_return_items r WHERE r.order_item_id=i.id)) THEN
   RAISE EXCEPTION 'RETURN_REQUIRES_REFUND_AND_ITEMS' USING ERRCODE='22023';END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER orders_operation_guard BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.guard_order_update();

CREATE FUNCTION private.guard_order_stock_reversal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.movement_type='REVERSAL' AND EXISTS(SELECT 1 FROM public.order_stock_operations WHERE movement_id=NEW.reversal_of_id) THEN
  RAISE EXCEPTION 'ORDER_STOCK_REVERSAL_REQUIRES_ORDER_FLOW' USING ERRCODE='22023';END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER inventory_order_reversal_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION private.guard_order_stock_reversal();

CREATE FUNCTION private.prevent_archive_with_open_orders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
  IF TG_TABLE_NAME='products' AND EXISTS(SELECT 1 FROM public.order_items i JOIN public.orders o ON o.id=i.order_id
   WHERE i.product_id=OLD.id AND o.status IN('PENDING','PAID','SHIPPED')) THEN
   RAISE EXCEPTION 'PRODUCT_HAS_OPEN_ORDERS' USING ERRCODE='22023';END IF;
  IF TG_TABLE_NAME='stores' AND EXISTS(SELECT 1 FROM public.orders WHERE store_id=OLD.id AND status IN('PENDING','PAID','SHIPPED')) THEN
   RAISE EXCEPTION 'STORE_HAS_OPEN_ORDERS' USING ERRCODE='22023';END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER products_open_orders_guard BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.prevent_archive_with_open_orders();
CREATE TRIGGER stores_open_orders_guard BEFORE UPDATE ON public.stores FOR EACH ROW EXECUTE FUNCTION private.prevent_archive_with_open_orders();

CREATE OR REPLACE FUNCTION public.get_public_order_status(p_store_slug text,p_order_id uuid,p_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('order_id',o.id,'code',o.code,'status',o.status,'revision',o.revision,'created_at',o.created_at,
  'subtotal',o.subtotal,'shipping_amount',o.shipping_amount,'shipping_confirmed',o.shipping_confirmed,
  'total',o.total,'shipping_included',o.shipping_confirmed,'payment_method',o.payment_method,
  'tracking_code',o.tracking_code,'paid_at',o.paid_at,'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,
  'cancelled_at',o.cancelled_at,'returned_at',o.returned_at,'customer',o.customer_snapshot,'address',o.delivery_address,'note',o.customer_note,
  'reservation_expires_at',o.reservation_expires_at,'reservation_active',o.status='PENDING' AND EXISTS(
   SELECT 1 FROM public.inventory_reservations r WHERE r.order_id=o.id AND r.state='HELD' AND r.expires_at>clock_timestamp()),
  'payment',jsonb_build_object('received',EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o.id AND kind='RECEIPT'),
   'refunded',EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o.id AND kind='REFUND'),
   'method',(SELECT method FROM public.order_payments WHERE order_id=o.id AND kind='RECEIPT')),
  'timeline',COALESCE((SELECT jsonb_agg(jsonb_build_object('event',h.event_type,'status',h.status_after,'created_at',h.created_at) ORDER BY h.revision)
   FROM public.order_status_history h WHERE h.order_id=o.id),'[]'::jsonb),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.product_name,'code',i.product_code,'quantity',i.quantity,
   'unit_price',i.unit_price,'line_total',i.line_total,'image_path',i.image_path,'attributes',i.attributes_snapshot) ORDER BY i.id)
   FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb))
 FROM public.orders o JOIN public.stores s ON s.id=o.store_id JOIN private.order_access a ON a.order_id=o.id
 JOIN public.profiles owner ON owner.id=s.owner_id AND owner.is_active
 WHERE o.id=p_order_id AND s.slug=p_store_slug AND s.archived_at IS NULL AND a.token_hash=p_token_hash;
$$;
-- Mantem a ACL da funcao substituida: nunca liberar EXECUTE a anon/authenticated.
REVOKE ALL ON FUNCTION public.get_public_order_status(text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_order_status(text,uuid,text) TO service_role;

CREATE TRIGGER orders_operations_audit AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER order_payments_audit AFTER INSERT ON public.order_payments FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER order_return_audit AFTER INSERT ON public.order_return_items FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();

REVOKE ALL ON FUNCTION private.order_event_created(),private.immutable_order_record(),private.lock_order(uuid,text),
 private.order_cached_request(uuid,uuid,jsonb),private.validate_order_note(text),private.validate_manual_method(text,text),
 private.check_order_revision(uuid,bigint),private.finish_order_operation(uuid,uuid,jsonb,text,public.order_status,text),
 private.restore_order_item_stock(uuid,text),private.record_manual_refund(uuid,uuid,text,text,text),
 private.guard_order_update(),private.guard_order_stock_reversal(),private.prevent_archive_with_open_orders()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.update_order_terms(uuid,uuid,bigint,numeric,text),
 public.confirm_order_payment(uuid,uuid,bigint,numeric,text,text,text),public.ship_order(uuid,uuid,bigint,text,text),
 public.deliver_order(uuid,uuid,bigint,text),public.cancel_order(uuid,uuid,bigint,text,boolean,text,text),
 public.return_order(uuid,uuid,bigint,jsonb,boolean,boolean,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_terms(uuid,uuid,bigint,numeric,text),
 public.confirm_order_payment(uuid,uuid,bigint,numeric,text,text,text),public.ship_order(uuid,uuid,bigint,text,text),
 public.deliver_order(uuid,uuid,bigint,text),public.cancel_order(uuid,uuid,bigint,text,boolean,text,text),
 public.return_order(uuid,uuid,bigint,jsonb,boolean,boolean,text,text,text)
 TO authenticated;
COMMIT;
