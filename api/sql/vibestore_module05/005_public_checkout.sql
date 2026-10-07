-- VibeStore / Modulo 05: vitrine publica, checkout manual e reservas
-- Dependencias: migrations 001..004. Executar UMA VEZ em desenvolvimento.
-- RPCs publicas de negocio sao acessiveis SOMENTE ao service_role da Edge Function.
-- Nunca colocar service_role no navegador. Sem pagamentos ou baixa fisica de pedidos.
BEGIN;
CREATE TYPE public.order_status AS ENUM('PENDING','PAID','SHIPPED','DELIVERED','RETURNED','CANCELLED');

CREATE TABLE public.customers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 phone text NOT NULL CHECK(phone ~ '^\+[1-9][0-9]{7,14}$'),
 full_name text NOT NULL CHECK(char_length(btrim(full_name)) BETWEEN 2 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT customers_store_phone UNIQUE(store_id,phone),CONSTRAINT customers_store_identity UNIQUE(id,store_id)
);
COMMENT ON TABLE public.customers IS 'Contato nao autenticado. Telefone autodeclarado nao comprova identidade. Nao existe lookup publico de PII.';
CREATE TABLE private.order_counters(store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE RESTRICT,sequence bigint NOT NULL DEFAULT 0);
REVOKE ALL ON private.order_counters FROM PUBLIC,anon,authenticated;

CREATE TABLE public.orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL,code text NOT NULL,status public.order_status NOT NULL DEFAULT 'PENDING',
 request_id uuid NOT NULL,request_payload jsonb NOT NULL,
 customer_snapshot jsonb NOT NULL,delivery_address jsonb NOT NULL,store_snapshot jsonb NOT NULL,
 customer_note text NOT NULL DEFAULT '' CHECK(char_length(customer_note)<=1000),
 payment_method text NOT NULL DEFAULT 'WHATSAPP' CHECK(payment_method='WHATSAPP'),
 subtotal numeric(12,2) NOT NULL CHECK(subtotal>=0 AND subtotal<>'NaN'::numeric),
 total numeric(12,2) NOT NULL CHECK(total=subtotal),
 reservation_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT orders_customer_store FOREIGN KEY(customer_id,store_id) REFERENCES public.customers(id,store_id),
 CONSTRAINT orders_store_identity UNIQUE(id,store_id),CONSTRAINT orders_store_code UNIQUE(store_id,code),
 CONSTRAINT orders_store_request UNIQUE(store_id,request_id)
);
COMMENT ON COLUMN public.orders.total IS 'Somente soma dos itens. Frete nao cotado/incluido; negociado manualmente no WhatsApp.';
COMMENT ON COLUMN public.orders.payment_method IS 'Canal de fechamento, nao confirmacao de pagamento.';
CREATE INDEX orders_store_date_idx ON public.orders(store_id,created_at DESC,id);
CREATE TABLE public.order_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,order_id uuid NOT NULL,product_id uuid NOT NULL,
 product_code text NOT NULL,product_name text NOT NULL,product_slug text NOT NULL,
 image_path text,attributes_snapshot jsonb NOT NULL DEFAULT '[]',
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999),unit_price numeric(12,2) NOT NULL CHECK(unit_price>=0),
 unit_cost_snapshot numeric(18,6) NOT NULL CHECK(unit_cost_snapshot>=0),
 line_total numeric(12,2) NOT NULL CHECK(line_total=quantity::numeric*unit_price),
 CONSTRAINT order_items_order_store FOREIGN KEY(order_id,store_id) REFERENCES public.orders(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_items_product_store FOREIGN KEY(product_id,store_id) REFERENCES public.products(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT order_items_product UNIQUE(order_id,product_id)
);
COMMENT ON COLUMN public.order_items.unit_cost_snapshot IS 'Referencia de custo medio na criacao. CMV final deve ser fixado na baixa fisica do modulo 06.';
CREATE INDEX order_items_store_idx ON public.order_items(store_id,order_id);
CREATE TABLE public.inventory_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,product_id uuid NOT NULL,order_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 999),
 state text NOT NULL DEFAULT 'HELD' CHECK(state IN('HELD','RELEASED','CONSUMED')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT inventory_reservations_product_store FOREIGN KEY(product_id,store_id) REFERENCES public.products(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_reservations_order_store FOREIGN KEY(order_id,store_id) REFERENCES public.orders(id,store_id) ON DELETE RESTRICT,
 CONSTRAINT inventory_reservations_order_product UNIQUE(order_id,product_id)
);
CREATE INDEX inventory_reservations_live_idx ON public.inventory_reservations(product_id,expires_at) WHERE state='HELD';
CREATE INDEX inventory_reservations_order_idx ON public.inventory_reservations(store_id,order_id);
CREATE TABLE private.order_access(
 order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
 token_hash text NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON private.order_access FROM PUBLIC,anon,authenticated;
CREATE TABLE private.public_rate_buckets(
 scope text NOT NULL,subject_hash text NOT NULL,window_start bigint NOT NULL,hits integer NOT NULL DEFAULT 0,
 PRIMARY KEY(scope,subject_hash,window_start)
);
REVOKE ALL ON private.public_rate_buckets FROM PUBLIC,anon,authenticated;

ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions(code,module,description,is_system) VALUES
 ('storefront.read','storefront','Disponibilizar a vitrine publica da loja.',true),
 ('orders.create','orders','Habilitar criacao publica de pedidos pelo WhatsApp.',true),
 ('orders.read','orders','Consultar pedidos privados da loja.',true),
 ('customers.read','customers','Consultar contatos privados da loja.',true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN('OWNER','SUDO') AND p.code IN('storefront.read','orders.create','orders.read','customers.read');

CREATE FUNCTION private.active_reserved_quantity(p_product_id uuid)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(sum(quantity),0)::integer FROM public.inventory_reservations
 WHERE product_id=p_product_id AND state='HELD' AND expires_at>clock_timestamp();
$$;
CREATE FUNCTION private.guard_stock_against_reservations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.quantity<private.active_reserved_quantity(NEW.product_id) THEN
  RAISE EXCEPTION 'STOCK_RESERVED_BY_PENDING_ORDERS' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_balances_reservation_guard BEFORE INSERT OR UPDATE ON public.inventory_balances
FOR EACH ROW EXECUTE FUNCTION private.guard_stock_against_reservations();
CREATE OR REPLACE VIEW public.product_stock_balances WITH(security_invoker=true) AS
SELECT p.id AS product_id,p.store_id,p.code,p.name,p.status,p.category_id,
 COALESCE(b.quantity,0)::integer AS quantity,COALESCE(b.stock_value,0)::numeric(26,6) AS stock_value,
 COALESCE(b.average_cost,0)::numeric(18,6) AS average_cost,COALESCE(b.revision,0)::bigint AS revision,
 b.last_movement_id,b.updated_at,
 reservation.quantity AS reserved_quantity,
 GREATEST(0,COALESCE(b.quantity,0)-reservation.quantity)::integer AS available_quantity
FROM public.products p LEFT JOIN public.inventory_balances b ON b.product_id=p.id AND b.store_id=p.store_id
CROSS JOIN LATERAL(SELECT private.active_reserved_quantity(p.id) AS quantity OFFSET 0)reservation
WHERE p.archived_at IS NULL AND private.catalog_store_allowed(p.store_id,'inventory.read');

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customers,public.orders,public.order_items,public.inventory_reservations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customers,public.orders,public.order_items,public.inventory_reservations TO authenticated;
GRANT SELECT ON public.customers,public.orders,public.order_items,public.inventory_reservations TO service_role;
CREATE POLICY customers_owner_read ON public.customers FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'customers.read'));
CREATE POLICY orders_owner_read ON public.orders FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));
CREATE POLICY order_items_owner_read ON public.order_items FOR SELECT TO authenticated USING(private.catalog_store_allowed(store_id,'orders.read'));
CREATE POLICY reservations_owner_read ON public.inventory_reservations FOR SELECT TO authenticated
USING(private.catalog_store_allowed(store_id,'inventory.read') OR private.catalog_store_allowed(store_id,'orders.read'));
-- Sem escrita do lojista por tabela; mudancas de status pertencem ao modulo 06.

CREATE FUNCTION private.public_store_allowed(p_store_id uuid,p_feature text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.stores s JOIN public.profiles owner ON owner.id=s.owner_id AND owner.is_active
  JOIN public.roles r ON r.code='OWNER' AND r.is_active
  JOIN public.role_permissions rp ON rp.role_id=r.id AND rp.is_enabled
  JOIN public.permissions permission ON permission.id=rp.permission_id AND permission.is_active
  WHERE s.id=p_store_id AND s.archived_at IS NULL AND s.is_published AND permission.code=p_feature
 );
$$;
CREATE FUNCTION private.public_product_allowed(p_product_id uuid,p_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.products p
  LEFT JOIN public.categories c ON c.id=p.category_id
  LEFT JOIN public.categories parent ON parent.id=c.parent_id
  WHERE p.id=p_product_id AND p.store_id=p_store_id AND p.archived_at IS NULL AND p.status='ACTIVE'
   AND (p.category_id IS NULL OR(c.store_id=p.store_id AND c.archived_at IS NULL AND c.is_active
    AND (c.parent_id IS NULL OR(parent.archived_at IS NULL AND parent.is_active)))));
$$;
CREATE FUNCTION private.public_product_json(p_product_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'slug',p.slug,'description',p.description,
  'price',p.price,'category_id',p.category_id,'is_featured',p.is_featured,
  'in_stock',COALESCE((SELECT quantity FROM public.inventory_balances WHERE product_id=p.id),0)-private.active_reserved_quantity(p.id)>0,
  'images',COALESCE((SELECT jsonb_agg(jsonb_build_object('path',i.path,'alt_text',i.alt_text,'sort_order',i.sort_order) ORDER BY i.sort_order)
   FROM public.product_images i WHERE i.product_id=p.id),'[]'::jsonb),
  'attributes',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a.name,'value',a.value) ORDER BY a.sort_order)
   FROM public.product_attributes a WHERE a.product_id=p.id),'[]'::jsonb))
 FROM public.products p WHERE p.id=p_product_id;
$$;


CREATE FUNCTION public.consume_public_rate_limit(p_scope text,p_subject_hash text,p_limit integer,p_window_seconds integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE slot bigint;n integer;retry integer;
BEGIN
 IF p_scope NOT IN('catalog','product','checkout','order-status','checkout-phone','client')
 OR p_subject_hash!~'^[0-9a-f]{64}$' OR p_limit NOT BETWEEN 1 AND 1000 OR p_window_seconds NOT BETWEEN 10 AND 3600 THEN
  RAISE EXCEPTION 'INVALID_RATE_LIMIT' USING ERRCODE='22023'; END IF;
 slot:=floor(extract(epoch FROM clock_timestamp())/p_window_seconds)::bigint*p_window_seconds;
 INSERT INTO private.public_rate_buckets(scope,subject_hash,window_start,hits) VALUES(p_scope,p_subject_hash,slot,1)
 ON CONFLICT(scope,subject_hash,window_start) DO UPDATE SET hits=LEAST(private.public_rate_buckets.hits+1,p_limit+1)
 RETURNING hits INTO n;
 retry:=GREATEST(1,slot+p_window_seconds-ceil(extract(epoch FROM clock_timestamp()))::bigint)::integer;
 -- Expurga no maximo 100 janelas antigas por chamada; nao depende de cron externo.
 DELETE FROM private.public_rate_buckets b WHERE(b.scope,b.subject_hash,b.window_start) IN(
  SELECT scope,subject_hash,window_start FROM private.public_rate_buckets WHERE window_start<slot-7200 LIMIT 100);
 RETURN jsonb_build_object('allowed',n<=p_limit,'retry_after',retry);
END;
$$;

CREATE FUNCTION public.get_public_catalog(p_store_slug text,p_filters jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.stores%ROWTYPE;term text;cat uuid;minimum numeric;maximum numeric;stock_only boolean;
 sort_key text;page_number integer;page_size integer;total_count integer;rows jsonb;
BEGIN
 SELECT * INTO s FROM public.stores WHERE slug=p_store_slug;
 IF NOT FOUND OR NOT private.public_store_allowed(s.id,'storefront.read') THEN RETURN NULL; END IF;
 PERFORM private.catalog_validate_input(p_filters,ARRAY['search','category_id','min_price','max_price','in_stock','sort','page','page_size']);
 term:=COALESCE(btrim(p_filters ->> 'search'),'');cat:=NULLIF(p_filters ->> 'category_id','')::uuid;
 minimum:=(p_filters ->> 'min_price')::numeric;maximum:=(p_filters ->> 'max_price')::numeric;
 stock_only:=COALESCE((p_filters ->> 'in_stock')::boolean,false);
 sort_key:=COALESCE(p_filters ->> 'sort','newest');page_number:=COALESCE((p_filters ->> 'page')::integer,1);
 page_size:=COALESCE((p_filters ->> 'page_size')::integer,20);
 IF char_length(term)>100 OR page_number NOT BETWEEN 1 AND 1000 OR page_size NOT BETWEEN 1 AND 24
 OR sort_key NOT IN('newest','price_asc','price_desc','name_asc')
 OR(minimum IS NOT NULL AND(minimum<0 OR minimum='NaN'::numeric))
 OR(maximum IS NOT NULL AND(maximum<0 OR maximum='NaN'::numeric)) OR(minimum>maximum) THEN
  RAISE EXCEPTION 'INVALID_CATALOG_FILTERS' USING ERRCODE='22023'; END IF;
 -- strpos trata o termo como texto literal, sem interpolar filtros PostgREST/SQL.
 WITH matches AS MATERIALIZED(
 SELECT p.id,p.name,p.price,p.created_at FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id
 LEFT JOIN public.inventory_balances b ON b.product_id=p.id
 WHERE private.public_product_allowed(p.id,s.id)
 AND(term='' OR strpos(lower(p.name || ' ' || p.description || ' ' || p.code),lower(term))>0)
 AND(cat IS NULL OR p.category_id=cat OR c.parent_id=cat)
 AND(minimum IS NULL OR p.price>=minimum) AND(maximum IS NULL OR p.price<=maximum)
 AND(NOT stock_only OR COALESCE(b.quantity,0)-private.active_reserved_quantity(p.id)>0)
 ),paged AS(
 SELECT p.id,row_number() OVER(ORDER BY
  CASE WHEN sort_key='price_asc' THEN p.price END ASC,
  CASE WHEN sort_key='price_desc' THEN p.price END DESC,
  CASE WHEN sort_key='name_asc' THEN p.name END ASC,
  CASE WHEN sort_key='newest' THEN p.created_at END DESC,p.id) AS ordinal
 FROM matches p ORDER BY ordinal OFFSET(page_number-1)*page_size LIMIT page_size
 )
 SELECT(SELECT count(*) FROM matches),COALESCE((SELECT jsonb_agg(private.public_product_json(p.id) ORDER BY p.ordinal)FROM paged p),'[]'::jsonb)
 INTO total_count,rows;
 RETURN jsonb_build_object('store',jsonb_build_object('name',s.name,'title',s.title,'subtitle',s.subtitle,'slug',s.slug,
  'logo_path',s.logo_path,'banner_path',s.banner_path,'primary_color',s.primary_color,'secondary_color',s.secondary_color,
  'social_links',s.social_links,'whatsapp_number',s.whatsapp_number),
  'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'parent_id',c.parent_id) ORDER BY c.sort_order,c.id)
   FROM public.categories c LEFT JOIN public.categories parent ON parent.id=c.parent_id
   WHERE c.store_id=s.id AND c.archived_at IS NULL AND c.is_active
    AND(c.parent_id IS NULL OR(parent.archived_at IS NULL AND parent.is_active))),'[]'::jsonb),
  'products',rows,'total',total_count,'page',page_number,'page_size',page_size);
END;
$$;
CREATE FUNCTION public.get_public_product(p_store_slug text,p_product_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT private.public_product_json(p.id) || jsonb_build_object('in_stock',COALESCE(b.quantity,0)-private.active_reserved_quantity(p.id)>0)
 FROM public.stores s JOIN public.products p ON p.store_id=s.id LEFT JOIN public.inventory_balances b ON b.product_id=p.id
 WHERE s.slug=p_store_slug AND p.slug=p_product_slug AND private.public_store_allowed(s.id,'storefront.read')
 AND private.public_product_allowed(p.id,s.id);
$$;

CREATE FUNCTION private.normalize_public_checkout(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE customer jsonb;address jsonb;items jsonb;normalized_items jsonb;
BEGIN
 PERFORM private.catalog_validate_input(p_input,ARRAY['customer','address','items','note']);
 customer:=p_input -> 'customer';address:=p_input -> 'address';items:=p_input -> 'items';
 PERFORM private.catalog_validate_input(customer,ARRAY['full_name','phone']);
 PERFORM private.catalog_validate_input(address,ARRAY['postal_code','street','number','complement','district','city','state']);
 IF EXISTS(SELECT 1 FROM jsonb_each(customer)e WHERE jsonb_typeof(e.value)<>'string')
 OR EXISTS(SELECT 1 FROM jsonb_each(address)e WHERE jsonb_typeof(e.value)<>'string') THEN
  RAISE EXCEPTION 'INVALID_CUSTOMER_OR_ADDRESS' USING ERRCODE='22023'; END IF;
 IF customer ->> 'phone' IS NULL OR(customer ->> 'phone')!~'^\+[1-9][0-9]{7,14}$'
 OR char_length(btrim(customer ->> 'full_name')) NOT BETWEEN 2 AND 120
 OR customer ->> 'full_name' IS NULL THEN RAISE EXCEPTION 'INVALID_CUSTOMER' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['postal_code','street','number','district','city','state'])field
  WHERE address ->> field IS NULL OR char_length(btrim(address ->> field)) NOT BETWEEN 1 AND 160)
 OR(address ->> 'postal_code')!~'^[0-9]{8}$' OR(address ->> 'state')!~'^[A-Z]{2}$'
 OR char_length(COALESCE(address ->> 'complement',''))>160 THEN
  RAISE EXCEPTION 'INVALID_DELIVERY_ADDRESS' USING ERRCODE='22023'; END IF;
 IF p_input ? 'note' AND jsonb_typeof(p_input -> 'note')<>'string' THEN
  RAISE EXCEPTION 'INVALID_CUSTOMER_NOTE' USING ERRCODE='22023'; END IF;
 IF char_length(COALESCE(p_input ->> 'note',''))>1000 OR items IS NULL OR jsonb_typeof(items)<>'array' THEN
  RAISE EXCEPTION 'INVALID_ORDER_ITEMS' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(items) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'ORDER_ITEMS_LIMIT_20' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(items)e(row) WHERE jsonb_typeof(e.row)<>'object') THEN
  RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(items)e(row) CROSS JOIN LATERAL jsonb_object_keys(e.row)k(key)
  WHERE k.key NOT IN('product_id','quantity')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(items)e(row)
  WHERE jsonb_typeof(e.row -> 'product_id') IS DISTINCT FROM 'string' OR jsonb_typeof(e.row -> 'quantity') IS DISTINCT FROM 'number') THEN
  RAISE EXCEPTION 'INVALID_ORDER_ITEM_FIELDS' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',(e.row ->> 'product_id')::uuid,'quantity',(e.row ->> 'quantity')::integer)
 ORDER BY(e.row ->> 'product_id')::uuid) INTO normalized_items FROM jsonb_array_elements(items)e(row);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_items)e(row) WHERE(e.row ->> 'quantity')::integer NOT BETWEEN 1 AND 999)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_items)e(row) GROUP BY e.row ->> 'product_id' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'INVALID_ORDER_ITEM_QUANTITY_OR_DUPLICATE' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('customer',jsonb_build_object('full_name',btrim(customer ->> 'full_name'),'phone',customer ->> 'phone'),
  'address',address,'items',normalized_items,'note',COALESCE(p_input ->> 'note',''));
END;
$$;

CREATE FUNCTION public.create_public_order(p_store_slug text,p_request_id uuid,p_input jsonb,p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.stores%ROWTYPE;o public.orders%ROWTYPE;payload jsonb;input jsonb;item jsonb;
 p public.products%ROWTYPE;customer_id uuid;qty integer;available integer;seq bigint;sum_total numeric:=0;expiry timestamptz;
BEGIN
 IF p_request_id IS NULL OR p_token_hash IS NULL OR p_token_hash!~'^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'INVALID_REQUEST_OR_TOKEN' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.stores WHERE slug=p_store_slug;
 IF NOT FOUND OR NOT private.public_store_allowed(s.id,'storefront.read') OR NOT private.public_store_allowed(s.id,'orders.create') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM public.stores WHERE id=s.id FOR UPDATE;
 IF NOT private.public_store_allowed(s.id,'storefront.read') OR NOT private.public_store_allowed(s.id,'orders.create') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 input:=private.normalize_public_checkout(p_input);
 payload:=jsonb_build_object('input',input,'token_hash',p_token_hash);
 SELECT * INTO o FROM public.orders WHERE store_id=s.id AND request_id=p_request_id;
 IF FOUND THEN
  IF o.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('order_id',o.id,'code',o.code,'subtotal',o.subtotal,'status',o.status,
   'reservation_expires_at',o.reservation_expires_at,'replayed',true,'whatsapp_number',o.store_snapshot ->> 'whatsapp_number');
 END IF;
 FOR item IN SELECT e.row FROM jsonb_array_elements(input -> 'items')e(row) LOOP
  SELECT * INTO p FROM public.products WHERE id=(item ->> 'product_id')::uuid AND store_id=s.id;
  IF NOT FOUND OR NOT private.public_product_allowed(p.id,s.id) THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  qty:=(item ->> 'quantity')::integer;
  SELECT COALESCE((SELECT quantity FROM public.inventory_balances WHERE product_id=p.id),0)-private.active_reserved_quantity(p.id) INTO available;
  IF available<qty THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_STOCK' USING ERRCODE='22023'; END IF;
  sum_total:=sum_total+qty::numeric*p.price;
 END LOOP;
 IF sum_total>9999999999.99 THEN RAISE EXCEPTION 'ORDER_TOTAL_LIMIT' USING ERRCODE='22023'; END IF;
 INSERT INTO public.customers(store_id,phone,full_name) VALUES(s.id,input #>> '{customer,phone}',input #>> '{customer,full_name}')
 ON CONFLICT(store_id,phone) DO NOTHING;
 SELECT id INTO customer_id FROM public.customers WHERE store_id=s.id AND phone=input #>> '{customer,phone}';
 INSERT INTO private.order_counters(store_id,sequence) VALUES(s.id,1)
 ON CONFLICT(store_id) DO UPDATE SET sequence=private.order_counters.sequence+1 RETURNING sequence INTO seq;
 expiry:=clock_timestamp()+interval '24 hours';
 INSERT INTO public.orders(store_id,customer_id,code,request_id,request_payload,customer_snapshot,delivery_address,store_snapshot,
  customer_note,subtotal,total,reservation_expires_at)
 VALUES(s.id,customer_id,'PED-'||lpad(seq::text,GREATEST(6,char_length(seq::text)),'0'),p_request_id,payload,
  input -> 'customer',input -> 'address',jsonb_build_object('name',s.name,'slug',s.slug,'whatsapp_number',s.whatsapp_number),
  input ->> 'note',sum_total,sum_total,expiry) RETURNING * INTO o;
 FOR item IN SELECT e.row FROM jsonb_array_elements(input -> 'items')e(row) LOOP
  SELECT * INTO p FROM public.products WHERE id=(item ->> 'product_id')::uuid;
  qty:=(item ->> 'quantity')::integer;
  INSERT INTO public.order_items(store_id,order_id,product_id,product_code,product_name,product_slug,image_path,attributes_snapshot,
   quantity,unit_price,unit_cost_snapshot,line_total)
  VALUES(s.id,o.id,p.id,p.code,p.name,p.slug,
   (SELECT path FROM public.product_images WHERE product_id=p.id ORDER BY sort_order LIMIT 1),
   COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a.name,'value',a.value) ORDER BY a.sort_order)
    FROM public.product_attributes a WHERE a.product_id=p.id),'[]'),qty,p.price,
   COALESCE((SELECT average_cost FROM public.inventory_balances WHERE product_id=p.id),0),qty::numeric*p.price);
  INSERT INTO public.inventory_reservations(store_id,product_id,order_id,quantity,expires_at) VALUES(s.id,p.id,o.id,qty,expiry);
 END LOOP;
 INSERT INTO private.order_access(order_id,token_hash) VALUES(o.id,p_token_hash);
 RETURN jsonb_build_object('order_id',o.id,'code',o.code,'subtotal',o.subtotal,'status',o.status,
  'reservation_expires_at',o.reservation_expires_at,'replayed',false,'whatsapp_number',s.whatsapp_number);
END;
$$;

CREATE FUNCTION public.get_public_order_status(p_store_slug text,p_order_id uuid,p_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('order_id',o.id,'code',o.code,'status',o.status,'created_at',o.created_at,
  'subtotal',o.subtotal,'total',o.total,'shipping_included',false,'payment_method',o.payment_method,
  'customer',o.customer_snapshot,'address',o.delivery_address,'note',o.customer_note,
  'reservation_expires_at',o.reservation_expires_at,'reservation_active',o.status='PENDING' AND EXISTS(
   SELECT 1 FROM public.inventory_reservations reservation WHERE reservation.order_id=o.id
    AND reservation.state='HELD' AND reservation.expires_at>clock_timestamp()),
  'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',i.product_name,'code',i.product_code,'quantity',i.quantity,
   'unit_price',i.unit_price,'line_total',i.line_total,'image_path',i.image_path,'attributes',i.attributes_snapshot) ORDER BY i.id)
   FROM public.order_items i WHERE i.order_id=o.id),'[]'::jsonb))
 FROM public.orders o JOIN public.stores s ON s.id=o.store_id JOIN private.order_access a ON a.order_id=o.id
 JOIN public.profiles owner ON owner.id=s.owner_id AND owner.is_active
 WHERE o.id=p_order_id AND s.slug=p_store_slug AND s.archived_at IS NULL AND a.token_hash=p_token_hash;
$$;

CREATE TRIGGER orders_audit AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
REVOKE ALL ON FUNCTION private.active_reserved_quantity(uuid),private.guard_stock_against_reservations(),
 private.public_store_allowed(uuid,text),private.public_product_allowed(uuid,uuid),private.public_product_json(uuid),
 private.normalize_public_checkout(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.active_reserved_quantity(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_public_rate_limit(text,text,integer,integer),public.get_public_catalog(text,jsonb),
 public.get_public_product(text,text),public.create_public_order(text,uuid,jsonb,text),public.get_public_order_status(text,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_rate_limit(text,text,integer,integer),public.get_public_catalog(text,jsonb),
 public.get_public_product(text,text),public.create_public_order(text,uuid,jsonb,text),public.get_public_order_status(text,uuid,text)
 TO service_role;
COMMIT;
