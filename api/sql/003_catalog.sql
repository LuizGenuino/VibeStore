-- VibeStore / Modulo 03: catalogo privado por loja
-- Dependencias: 001_identity_rbac.sql e 002_plans_stores_branding.sql do reinicio.
-- Executar UMA VEZ em desenvolvimento. Nenhuma tabela do catalogo e publica.
-- Estoque/quantidade serao implementados no modulo 04. Custo aqui e de referencia.
BEGIN;
CREATE TYPE public.product_status AS ENUM ('ACTIVE', 'INACTIVE');

CREATE FUNCTION private.catalog_slug(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
  pg_catalog.translate(pg_catalog.lower(pg_catalog.btrim(p_name)),
   'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
  '[^a-z0-9]+', '-', 'g'), '-');
$$;

CREATE TABLE private.catalog_counters (
 store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE RESTRICT,
 category_sequence bigint NOT NULL DEFAULT 0,
 product_sequence bigint NOT NULL DEFAULT 0
);
ALTER TABLE private.catalog_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.catalog_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.catalog_counters TO service_role;

CREATE FUNCTION private.next_catalog_code(p_store_id uuid, p_kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n bigint; prefix text;
BEGIN
 INSERT INTO private.catalog_counters(store_id) VALUES (p_store_id) ON CONFLICT DO NOTHING;
 IF p_kind = 'category' THEN
  UPDATE private.catalog_counters SET category_sequence = category_sequence + 1
  WHERE store_id = p_store_id RETURNING category_sequence INTO n;
  prefix := 'CAT-';
 ELSIF p_kind = 'product' THEN
  UPDATE private.catalog_counters SET product_sequence = product_sequence + 1
  WHERE store_id = p_store_id RETURNING product_sequence INTO n;
  prefix := 'PRD-';
 ELSE RAISE EXCEPTION 'INVALID_CODE_KIND' USING ERRCODE = '22023'; END IF;
 RETURN prefix || pg_catalog.lpad(n::text, GREATEST(6, pg_catalog.char_length(n::text)), '0');
END;
$$;

CREATE TABLE public.categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 parent_id uuid,
 code text NOT NULL,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
 slug text NOT NULL CHECK (char_length(slug) BETWEEN 2 AND 100 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 1000000),
 request_id uuid NOT NULL,
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 CONSTRAINT categories_store_identity UNIQUE (id, store_id),
 CONSTRAINT categories_store_code UNIQUE (store_id, code),
 CONSTRAINT categories_store_slug UNIQUE (store_id, slug),
 CONSTRAINT categories_store_request UNIQUE (store_id, request_id),
 CONSTRAINT categories_parent_store FOREIGN KEY (parent_id, store_id)
  REFERENCES public.categories(id, store_id) ON DELETE RESTRICT,
 CONSTRAINT categories_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
 CONSTRAINT categories_archived_inactive CHECK (archived_at IS NULL OR NOT is_active)
);
CREATE INDEX categories_parent_idx ON public.categories(store_id, parent_id);
CREATE INDEX categories_live_order_idx ON public.categories(store_id, sort_order, id) WHERE archived_at IS NULL;

CREATE TABLE public.products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
 category_id uuid,
 code text NOT NULL,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
 slug text NOT NULL CHECK (char_length(slug) BETWEEN 2 AND 160 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 10000),
 status public.product_status NOT NULL DEFAULT 'INACTIVE',
 price numeric(12,2) NOT NULL CHECK (price >= 0 AND price <> 'NaN'::numeric),
 cost_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0 AND cost_price <> 'NaN'::numeric),
 is_featured boolean NOT NULL DEFAULT false,
 request_id uuid NOT NULL,
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 archived_at timestamptz,
 CONSTRAINT products_store_identity UNIQUE (id, store_id),
 CONSTRAINT products_store_code UNIQUE (store_id, code),
 CONSTRAINT products_store_slug UNIQUE (store_id, slug),
 CONSTRAINT products_store_request UNIQUE (store_id, request_id),
 CONSTRAINT products_category_store FOREIGN KEY (category_id, store_id)
  REFERENCES public.categories(id, store_id) ON DELETE RESTRICT,
 CONSTRAINT products_archived_inactive CHECK (archived_at IS NULL OR status = 'INACTIVE')
);
CREATE INDEX products_category_idx ON public.products(store_id, category_id);
CREATE INDEX products_live_list_idx ON public.products(store_id, created_at DESC, id) WHERE archived_at IS NULL;
CREATE INDEX products_live_price_idx ON public.products(store_id, price, id) WHERE archived_at IS NULL;
COMMENT ON COLUMN public.products.description IS 'Texto simples; nao renderizar como HTML sem sanitizacao.';
COMMENT ON COLUMN public.products.cost_price IS 'Custo de referencia cadastral. Nao e CMV historico nem custo medio de estoque.';
COMMENT ON TABLE public.products IS 'Sem coluna quantity: o modulo 04 calculara saldos por movimentacoes.';

CREATE TABLE public.product_attributes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
 name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
 value text NOT NULL CHECK (char_length(btrim(value)) BETWEEN 1 AND 500),
 sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 29),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT product_attributes_product_store FOREIGN KEY (product_id, store_id)
  REFERENCES public.products(id, store_id) ON DELETE RESTRICT,
 CONSTRAINT product_attributes_name UNIQUE (product_id, name_key),
 CONSTRAINT product_attributes_position UNIQUE (product_id, sort_order)
);
CREATE INDEX product_attributes_store_idx ON public.product_attributes(store_id, product_id);

CREATE FUNCTION private.product_media_location(p_path text)
RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s uuid; p uuid; f uuid;
BEGIN
 IF p_path IS NULL OR p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$' THEN RETURN NULL; END IF;
 s := pg_catalog.split_part(p_path, '/', 1)::uuid;
 p := pg_catalog.split_part(p_path, '/', 2)::uuid;
 f := pg_catalog.split_part(pg_catalog.split_part(p_path, '/', 3), '.', 1)::uuid;
 RETURN ARRAY[s, p];
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE TABLE public.product_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 store_id uuid NOT NULL,
 product_id uuid NOT NULL,
 path text NOT NULL UNIQUE,
 alt_text text NOT NULL DEFAULT '' CHECK (char_length(alt_text) <= 200),
 sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 3),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT product_images_product_store FOREIGN KEY (product_id, store_id)
  REFERENCES public.products(id, store_id) ON DELETE RESTRICT,
 CONSTRAINT product_images_path CHECK (COALESCE(private.product_media_location(path) = ARRAY[store_id, product_id], false)),
 CONSTRAINT product_images_position UNIQUE (product_id, sort_order) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX product_images_store_idx ON public.product_images(store_id, product_id);
COMMENT ON COLUMN public.product_images.sort_order IS 'Posicoes 0..3: no maximo 4 imagens vinculadas. A menor posicao e a capa.';

ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions(code, module, description, is_system) VALUES
 ('catalog.read', 'catalog', 'Consultar o catalogo privado da loja.', true),
 ('catalog.categories.manage', 'catalog', 'Criar, editar e arquivar categorias/subcategorias.', true),
 ('catalog.products.manage', 'catalog', 'Criar, editar, arquivar produtos e substituir atributos.', true),
 ('catalog.products.media', 'catalog', 'Enviar, vincular, ordenar e desvincular imagens de produtos.', true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code IN ('OWNER', 'SUDO') AND p.module = 'catalog';

-- Toda mudanca estrutural do catalogo trava a loja antes de validar relacoes.
-- Isso evita corrida entre mudar hierarquia, arquivar categoria e vincular produto.
CREATE FUNCTION private.lock_catalog_store(p_store_id uuid, p_permission text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store public.stores%ROWTYPE;
BEGIN
 IF NOT private.has_store_permission(p_store_id, p_permission) THEN
  RAISE EXCEPTION 'CATALOG_FORBIDDEN' USING ERRCODE = '42501'; END IF;
 SELECT * INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
 IF NOT FOUND OR v_store.archived_at IS NOT NULL
    OR NOT private.has_store_permission(p_store_id, p_permission) THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE FUNCTION private.catalog_store_allowed(p_store_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.archived_at IS NULL
  AND private.has_store_permission(s.id, p_permission));
$$;

CREATE FUNCTION private.catalog_product_allowed(p_product_id uuid, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.products p JOIN public.stores s ON s.id = p.store_id
  WHERE p.id = p_product_id AND p.archived_at IS NULL AND s.archived_at IS NULL
   AND private.has_store_permission(p.store_id, p_permission)
 );
$$;

CREATE FUNCTION private.validate_category()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent public.categories%ROWTYPE;
BEGIN
 PERFORM private.lock_catalog_store(NEW.store_id, 'catalog.categories.manage');
 IF TG_OP = 'UPDATE' AND (
  NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id
  OR NEW.code IS DISTINCT FROM OLD.code OR NEW.request_id IS DISTINCT FROM OLD.request_id
  OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
 ) THEN RAISE EXCEPTION 'CATEGORY_IDENTITY_IMMUTABLE' USING ERRCODE = '42501'; END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO parent FROM public.categories WHERE id = NEW.parent_id AND store_id = NEW.store_id;
  IF NOT FOUND OR parent.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'CATEGORY_PARENT_UNAVAILABLE' USING ERRCODE = '23503'; END IF;
  IF parent.parent_id IS NOT NULL OR NEW.parent_id = NEW.id THEN
   RAISE EXCEPTION 'CATEGORY_MAX_TWO_LEVELS' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.categories WHERE parent_id = NEW.id AND archived_at IS NULL) THEN
   RAISE EXCEPTION 'CATEGORY_WITH_CHILDREN_CANNOT_BECOME_CHILD' USING ERRCODE = '22023'; END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL THEN
  RAISE EXCEPTION 'CATEGORY_ARCHIVED' USING ERRCODE = '22023'; END IF;
 IF NEW.archived_at IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM public.categories WHERE parent_id = NEW.id AND archived_at IS NULL) THEN
   RAISE EXCEPTION 'CATEGORY_HAS_LIVE_CHILDREN' USING ERRCODE = '23503'; END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE category_id = NEW.id AND archived_at IS NULL) THEN
   RAISE EXCEPTION 'CATEGORY_HAS_LIVE_PRODUCTS' USING ERRCODE = '23503'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE FUNCTION private.validate_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM private.lock_catalog_store(NEW.store_id, 'catalog.products.manage');
 IF TG_OP = 'UPDATE' AND (
  NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id
  OR NEW.code IS DISTINCT FROM OLD.code OR NEW.request_id IS DISTINCT FROM OLD.request_id
  OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
 ) THEN RAISE EXCEPTION 'PRODUCT_IDENTITY_IMMUTABLE' USING ERRCODE = '42501'; END IF;
 IF TG_OP = 'UPDATE' AND OLD.archived_at IS NOT NULL THEN
  RAISE EXCEPTION 'PRODUCT_ARCHIVED' USING ERRCODE = '22023'; END IF;
 IF NEW.category_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE c.id = NEW.category_id AND c.store_id = NEW.store_id AND c.archived_at IS NULL
 ) THEN RAISE EXCEPTION 'PRODUCT_CATEGORY_UNAVAILABLE' USING ERRCODE = '23503'; END IF;
 RETURN NEW;
END;
$$;

CREATE FUNCTION private.validate_product_image()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s uuid; p uuid; path text;
BEGIN
 IF TG_OP = 'DELETE' THEN s := OLD.store_id; p := OLD.product_id; path := OLD.path;
 ELSE s := NEW.store_id; p := NEW.product_id; path := NEW.path; END IF;
 PERFORM private.lock_catalog_store(s, 'catalog.products.media');
 IF NOT private.catalog_product_allowed(p, 'catalog.products.media') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.store_id IS DISTINCT FROM OLD.store_id
  OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.path IS DISTINCT FROM OLD.path) THEN
  RAISE EXCEPTION 'PRODUCT_IMAGE_IDENTITY_IMMUTABLE' USING ERRCODE = '42501'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 IF private.product_media_location(path) IS DISTINCT FROM ARRAY[s,p] THEN
  RAISE EXCEPTION 'INVALID_PRODUCT_IMAGE_PATH' USING ERRCODE = '23514'; END IF;
 PERFORM 1 FROM storage.objects WHERE bucket_id = 'product-images' AND name = path FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_IMAGE_OBJECT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
 RETURN NEW;
END;
$$;

CREATE TRIGGER categories_validate BEFORE INSERT OR UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION private.validate_category();
CREATE TRIGGER products_validate BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.validate_product();
CREATE TRIGGER product_images_validate BEFORE INSERT OR UPDATE OR DELETE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION private.validate_product_image();
CREATE TRIGGER categories_touch BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER products_touch BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER product_images_touch BEFORE UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER product_attributes_touch BEFORE UPDATE ON public.product_attributes FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_attributes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.categories, public.products, public.product_images, public.product_attributes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.categories, public.products, public.product_images, public.product_attributes TO authenticated;
-- Escrita do catalogo somente por RPC: ordem uniforme de locks (loja antes dos itens).
GRANT ALL ON public.categories, public.products, public.product_images, public.product_attributes TO service_role;

CREATE POLICY categories_read ON public.categories FOR SELECT TO authenticated
USING (archived_at IS NULL AND private.catalog_store_allowed(store_id, 'catalog.read'));
CREATE POLICY products_read ON public.products FOR SELECT TO authenticated
USING (archived_at IS NULL AND private.catalog_store_allowed(store_id, 'catalog.read'));
CREATE POLICY product_images_read ON public.product_images FOR SELECT TO authenticated
USING (private.catalog_product_allowed(product_id, 'catalog.read'));
CREATE POLICY product_attributes_read ON public.product_attributes FOR SELECT TO authenticated
USING (private.catalog_product_allowed(product_id, 'catalog.read'));
-- Sem policies/grants de INSERT/UPDATE/DELETE para clientes: toda escrita passa por RPC.


CREATE FUNCTION private.catalog_validate_input(p_input jsonb, p_fields text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
 IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input) <> 'object'
 OR pg_catalog.pg_column_size(p_input) > 32768 THEN
  RAISE EXCEPTION 'INVALID_CATALOG_INPUT' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_input) k(key) WHERE NOT k.key = ANY(p_fields)) THEN
  RAISE EXCEPTION 'UNKNOWN_CATALOG_FIELD' USING ERRCODE = '22023'; END IF;
END;
$$;

CREATE FUNCTION private.catalog_normalize_attributes(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
 IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array' THEN
  RAISE EXCEPTION 'ATTRIBUTES_ARRAY_REQUIRED' USING ERRCODE = '22023'; END IF;
 IF pg_catalog.jsonb_array_length(p_rows) > 30 OR pg_catalog.pg_column_size(p_rows) > 32768 THEN
  RAISE EXCEPTION 'ATTRIBUTES_LIMIT_30' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) e(row)
 WHERE pg_catalog.jsonb_typeof(e.row) <> 'object') THEN
  RAISE EXCEPTION 'INVALID_ATTRIBUTE' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) e(row)
  CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(e.row) k(key) WHERE k.key NOT IN ('name','value')) THEN
  RAISE EXCEPTION 'UNKNOWN_ATTRIBUTE_FIELD' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) e(row)
 WHERE pg_catalog.jsonb_typeof(e.row -> 'name') IS DISTINCT FROM 'string'
  OR pg_catalog.jsonb_typeof(e.row -> 'value') IS DISTINCT FROM 'string'
  OR pg_catalog.char_length(pg_catalog.btrim(e.row ->> 'name')) NOT BETWEEN 1 AND 80
  OR pg_catalog.char_length(pg_catalog.btrim(e.row ->> 'value')) NOT BETWEEN 1 AND 500) THEN
  RAISE EXCEPTION 'INVALID_ATTRIBUTE_NAME_OR_VALUE' USING ERRCODE = '22023'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) e(row)
  GROUP BY pg_catalog.lower(pg_catalog.btrim(e.row ->> 'name')) HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'DUPLICATE_ATTRIBUTE_NAME' USING ERRCODE = '22023'; END IF;
 SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'name', pg_catalog.btrim(e.row ->> 'name'), 'value', pg_catalog.btrim(e.row ->> 'value')) ORDER BY e.pos), '[]'::jsonb)
 INTO v_result FROM pg_catalog.jsonb_array_elements(p_rows) WITH ORDINALITY e(row,pos);
 RETURN v_result;
END;
$$;

CREATE FUNCTION public.replace_product_attributes(p_product_id uuid, p_attributes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; v_rows jsonb; n integer;
BEGIN
 IF NOT private.catalog_product_allowed(p_product_id, 'catalog.products.manage') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 PERFORM private.lock_catalog_store(p.store_id, 'catalog.products.manage');
 SELECT * INTO p FROM public.products WHERE id = p_product_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 v_rows := private.catalog_normalize_attributes(p_attributes);
 DELETE FROM public.product_attributes WHERE product_id = p_product_id;
 INSERT INTO public.product_attributes(store_id, product_id, name, value, sort_order)
 SELECT p.store_id, p.id, e.row ->> 'name', e.row ->> 'value', (e.pos - 1)::smallint
 FROM pg_catalog.jsonb_array_elements(v_rows) WITH ORDINALITY e(row,pos);
 GET DIAGNOSTICS n = ROW_COUNT;
 RETURN pg_catalog.jsonb_build_object('product_id', p.id, 'count', n);
END;
$$;

CREATE FUNCTION public.create_category(p_store_id uuid, p_request_id uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.categories%ROWTYPE; v_payload jsonb; v_name text; v_slug text;
 v_parent uuid; v_active boolean; v_sort integer; v_code text; v_constraint text;
BEGIN
 PERFORM private.lock_catalog_store(p_store_id, 'catalog.categories.manage');
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_REQUIRED' USING ERRCODE = '22004'; END IF;
 PERFORM private.catalog_validate_input(p_input, ARRAY['name','slug','parent_id','is_active','sort_order']);
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_input) e
 WHERE (e.key IN ('name','slug','parent_id') AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null'))
 OR (e.key = 'is_active' AND pg_catalog.jsonb_typeof(e.value) <> 'boolean')
 OR (e.key = 'sort_order' AND pg_catalog.jsonb_typeof(e.value) <> 'number')) THEN
  RAISE EXCEPTION 'INVALID_CATEGORY_FIELD_TYPE' USING ERRCODE = '22023'; END IF;
 v_name := pg_catalog.btrim(p_input ->> 'name');
 v_slug := COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(p_input ->> 'slug')), ''), private.catalog_slug(v_name));
 v_parent := NULLIF(p_input ->> 'parent_id','')::uuid;
 v_active := COALESCE((p_input ->> 'is_active')::boolean, true);
 v_sort := COALESCE((p_input ->> 'sort_order')::integer, 0);
 v_payload := pg_catalog.jsonb_build_object('name',v_name,'slug',v_slug,'parent_id',v_parent,'is_active',v_active,'sort_order',v_sort);
 SELECT * INTO c FROM public.categories WHERE store_id = p_store_id AND request_id = p_request_id;
 IF FOUND THEN
  IF c.request_payload IS DISTINCT FROM v_payload THEN
   RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  IF c.archived_at IS NOT NULL THEN RAISE EXCEPTION 'CATEGORY_ARCHIVED' USING ERRCODE = '22023'; END IF;
  RETURN pg_catalog.jsonb_build_object('category_id',c.id,'code',c.code,'slug',c.slug,'created',false);
 END IF;
 v_code := private.next_catalog_code(p_store_id,'category');
 INSERT INTO public.categories(store_id,parent_id,code,name,slug,is_active,sort_order,request_id,request_payload)
 VALUES(p_store_id,v_parent,v_code,v_name,v_slug,v_active,v_sort,p_request_id,v_payload) RETURNING * INTO c;
 RETURN pg_catalog.jsonb_build_object('category_id',c.id,'code',c.code,'slug',c.slug,'created',true);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
 IF v_constraint = 'categories_store_slug' THEN RAISE EXCEPTION 'CATEGORY_SLUG_EXISTS' USING ERRCODE = '23505'; END IF;
 RAISE;
END;
$$;

CREATE FUNCTION public.create_product(p_store_id uuid, p_request_id uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; v_payload jsonb; v_name text; v_slug text; v_description text;
 v_category uuid; v_status public.product_status; v_price numeric; v_cost numeric;
 v_featured boolean; v_attrs jsonb; v_code text; v_constraint text;
BEGIN
 PERFORM private.lock_catalog_store(p_store_id,'catalog.products.manage');
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_REQUIRED' USING ERRCODE = '22004'; END IF;
 PERFORM private.catalog_validate_input(p_input, ARRAY['name','slug','description','category_id','status','price','cost_price','is_featured','attributes']);
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_input) e
 WHERE (e.key IN ('name','slug','description','category_id','status') AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null'))
 OR (e.key IN ('price','cost_price') AND pg_catalog.jsonb_typeof(e.value) <> 'number')
 OR (e.key = 'is_featured' AND pg_catalog.jsonb_typeof(e.value) <> 'boolean')) THEN
  RAISE EXCEPTION 'INVALID_PRODUCT_FIELD_TYPE' USING ERRCODE = '22023'; END IF;
 v_name := pg_catalog.btrim(p_input ->> 'name');
 v_slug := COALESCE(NULLIF(pg_catalog.lower(pg_catalog.btrim(p_input ->> 'slug')), ''),private.catalog_slug(v_name));
 v_description := COALESCE(p_input ->> 'description','');
 v_category := NULLIF(p_input ->> 'category_id','')::uuid;
 v_status := COALESCE(p_input ->> 'status','INACTIVE')::public.product_status;
 v_price := (p_input ->> 'price')::numeric;
 v_cost := COALESCE((p_input ->> 'cost_price')::numeric,0);
 v_featured := COALESCE((p_input ->> 'is_featured')::boolean,false);
 IF v_price IS NULL OR v_price < 0 OR v_price > 9999999999.99 OR v_price <> pg_catalog.round(v_price,2)
 OR v_cost < 0 OR v_cost > 9999999999.99 OR v_cost <> pg_catalog.round(v_cost,2) THEN
  RAISE EXCEPTION 'INVALID_MONEY_VALUE' USING ERRCODE = '22023'; END IF;
 v_attrs := private.catalog_normalize_attributes(COALESCE(p_input -> 'attributes','[]'::jsonb));
 v_payload := pg_catalog.jsonb_build_object('name',v_name,'slug',v_slug,'description',v_description,
  'category_id',v_category,'status',v_status,'price',v_price,'cost_price',v_cost,'is_featured',v_featured,'attributes',v_attrs);
 SELECT * INTO p FROM public.products WHERE store_id = p_store_id AND request_id = p_request_id;
 IF FOUND THEN
  IF p.request_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '22023'; END IF;
  IF p.archived_at IS NOT NULL THEN RAISE EXCEPTION 'PRODUCT_ARCHIVED' USING ERRCODE = '22023'; END IF;
  RETURN pg_catalog.jsonb_build_object('product_id',p.id,'code',p.code,'slug',p.slug,'created',false);
 END IF;
 v_code := private.next_catalog_code(p_store_id,'product');
 INSERT INTO public.products(store_id,category_id,code,name,slug,description,status,price,cost_price,is_featured,request_id,request_payload)
 VALUES(p_store_id,v_category,v_code,v_name,v_slug,v_description,v_status,v_price,v_cost,v_featured,p_request_id,v_payload)
 RETURNING * INTO p;
 PERFORM public.replace_product_attributes(p.id,v_attrs);
 RETURN pg_catalog.jsonb_build_object('product_id',p.id,'code',p.code,'slug',p.slug,'created',true);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
 IF v_constraint = 'products_store_slug' THEN RAISE EXCEPTION 'PRODUCT_SLUG_EXISTS' USING ERRCODE = '23505'; END IF;
 RAISE;
END;
$$;

CREATE FUNCTION public.update_category(p_category_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.categories%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.categories WHERE id = p_category_id;
 IF NOT FOUND OR c.archived_at IS NOT NULL OR NOT private.catalog_store_allowed(c.store_id,'catalog.categories.manage') THEN
  RAISE EXCEPTION 'CATEGORY_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 PERFORM private.lock_catalog_store(c.store_id,'catalog.categories.manage');
 PERFORM private.catalog_validate_input(p_patch,ARRAY['name','slug','parent_id','is_active','sort_order']);
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_patch) e
 WHERE (e.key IN ('name','slug','parent_id') AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null'))
 OR (e.key = 'is_active' AND pg_catalog.jsonb_typeof(e.value) <> 'boolean')
 OR (e.key = 'sort_order' AND pg_catalog.jsonb_typeof(e.value) <> 'number')) THEN
  RAISE EXCEPTION 'INVALID_CATEGORY_FIELD_TYPE' USING ERRCODE = '22023'; END IF;
 UPDATE public.categories SET
  name = CASE WHEN p_patch ? 'name' THEN pg_catalog.btrim(p_patch ->> 'name') ELSE name END,
  slug = CASE WHEN p_patch ? 'slug' THEN pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'slug')) ELSE slug END,
  parent_id = CASE WHEN p_patch ? 'parent_id' THEN NULLIF(p_patch ->> 'parent_id','')::uuid ELSE parent_id END,
  is_active = CASE WHEN p_patch ? 'is_active' THEN (p_patch ->> 'is_active')::boolean ELSE is_active END,
  sort_order = CASE WHEN p_patch ? 'sort_order' THEN (p_patch ->> 'sort_order')::integer ELSE sort_order END
 WHERE id = p_category_id RETURNING * INTO c;
 RETURN pg_catalog.jsonb_build_object('category_id',c.id,'updated_at',c.updated_at);
END;
$$;

CREATE FUNCTION public.update_product(p_product_id uuid, p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; v_price numeric; v_cost numeric;
BEGIN
 IF NOT private.catalog_product_allowed(p_product_id,'catalog.products.manage') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 PERFORM private.lock_catalog_store(p.store_id,'catalog.products.manage');
 SELECT * INTO p FROM public.products WHERE id = p_product_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 PERFORM private.catalog_validate_input(p_patch,ARRAY['name','slug','description','category_id','status','price','cost_price','is_featured','attributes']);
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_patch) e
 WHERE (e.key IN ('name','slug','description','category_id','status') AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null'))
 OR (e.key IN ('price','cost_price') AND pg_catalog.jsonb_typeof(e.value) <> 'number')
 OR (e.key = 'is_featured' AND pg_catalog.jsonb_typeof(e.value) <> 'boolean')) THEN
  RAISE EXCEPTION 'INVALID_PRODUCT_FIELD_TYPE' USING ERRCODE = '22023'; END IF;
 v_price := CASE WHEN p_patch ? 'price' THEN (p_patch ->> 'price')::numeric ELSE p.price END;
 v_cost := CASE WHEN p_patch ? 'cost_price' THEN (p_patch ->> 'cost_price')::numeric ELSE p.cost_price END;
 IF v_price < 0 OR v_price > 9999999999.99 OR v_price <> pg_catalog.round(v_price,2)
 OR v_cost < 0 OR v_cost > 9999999999.99 OR v_cost <> pg_catalog.round(v_cost,2) THEN
  RAISE EXCEPTION 'INVALID_MONEY_VALUE' USING ERRCODE = '22023'; END IF;
 UPDATE public.products SET
  name = CASE WHEN p_patch ? 'name' THEN pg_catalog.btrim(p_patch ->> 'name') ELSE name END,
  slug = CASE WHEN p_patch ? 'slug' THEN pg_catalog.lower(pg_catalog.btrim(p_patch ->> 'slug')) ELSE slug END,
  description = CASE WHEN p_patch ? 'description' THEN COALESCE(p_patch ->> 'description','') ELSE description END,
  category_id = CASE WHEN p_patch ? 'category_id' THEN NULLIF(p_patch ->> 'category_id','')::uuid ELSE category_id END,
  status = CASE WHEN p_patch ? 'status' THEN (p_patch ->> 'status')::public.product_status ELSE status END,
  price = v_price, cost_price = v_cost,
  is_featured = CASE WHEN p_patch ? 'is_featured' THEN (p_patch ->> 'is_featured')::boolean ELSE is_featured END
 WHERE id = p_product_id RETURNING * INTO p;
 IF p_patch ? 'attributes' THEN PERFORM public.replace_product_attributes(p.id,p_patch -> 'attributes'); END IF;
 RETURN pg_catalog.jsonb_build_object('product_id',p.id,'updated_at',p.updated_at,'status',p.status);
END;
$$;

CREATE FUNCTION public.archive_category(p_category_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.categories%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.categories WHERE id = p_category_id;
 IF NOT FOUND OR NOT private.catalog_store_allowed(c.store_id,'catalog.categories.manage') THEN
  RAISE EXCEPTION 'CATEGORY_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 PERFORM private.lock_catalog_store(c.store_id,'catalog.categories.manage');
 SELECT * INTO c FROM public.categories WHERE id = p_category_id;
 IF c.archived_at IS NOT NULL THEN
  RETURN pg_catalog.jsonb_build_object('category_id',c.id,'archived',true,'already_archived',true); END IF;
 UPDATE public.categories SET is_active = false, archived_at = pg_catalog.now() WHERE id = c.id;
 RETURN pg_catalog.jsonb_build_object('category_id',c.id,'archived',true,'already_archived',false);
END;
$$;

CREATE FUNCTION public.archive_product(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 IF NOT FOUND OR NOT private.catalog_store_allowed(p.store_id,'catalog.products.manage') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 PERFORM private.lock_catalog_store(p.store_id,'catalog.products.manage');
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 IF p.archived_at IS NOT NULL THEN
  RETURN pg_catalog.jsonb_build_object('product_id',p.id,'archived',true,'already_archived',true); END IF;
 UPDATE public.products SET status = 'INACTIVE', archived_at = pg_catalog.now() WHERE id = p.id;
 RETURN pg_catalog.jsonb_build_object('product_id',p.id,'archived',true,'already_archived',false);
END;
$$;

CREATE FUNCTION public.attach_product_image(p_product_id uuid, p_path text, p_alt_text text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; img public.product_images%ROWTYPE; slot smallint;
BEGIN
 IF NOT private.catalog_product_allowed(p_product_id,'catalog.products.media') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 PERFORM private.lock_catalog_store(p.store_id,'catalog.products.media');
 IF NOT private.catalog_product_allowed(p_product_id,'catalog.products.media') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO img FROM public.product_images WHERE path = p_path AND product_id = p_product_id;
 IF FOUND THEN RETURN pg_catalog.jsonb_build_object('image_id',img.id,'sort_order',img.sort_order,'created',false); END IF;
 SELECT n::smallint INTO slot FROM pg_catalog.generate_series(0,3) n
 WHERE NOT EXISTS (SELECT 1 FROM public.product_images i WHERE i.product_id = p_product_id AND i.sort_order = n)
 ORDER BY n LIMIT 1;
 IF slot IS NULL THEN RAISE EXCEPTION 'PRODUCT_IMAGES_LIMIT_4' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.product_images(store_id,product_id,path,alt_text,sort_order)
 VALUES(p.store_id,p.id,p_path,COALESCE(p_alt_text,''),slot) RETURNING * INTO img;
 RETURN pg_catalog.jsonb_build_object('image_id',img.id,'sort_order',img.sort_order,'created',true);
END;
$$;

CREATE FUNCTION public.detach_product_image(p_product_id uuid, p_image_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; v_path text;
BEGIN
 IF NOT private.catalog_product_allowed(p_product_id,'catalog.products.media') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 PERFORM private.lock_catalog_store(p.store_id,'catalog.products.media');
 DELETE FROM public.product_images WHERE id = p_image_id AND product_id = p_product_id RETURNING path INTO v_path;
 RETURN pg_catalog.jsonb_build_object('product_id',p_product_id,'image_id',p_image_id,'detached',v_path IS NOT NULL,'path',v_path);
END;
$$;

CREATE FUNCTION public.reorder_product_images(p_product_id uuid, p_image_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.products%ROWTYPE; n integer;
BEGIN
 IF NOT private.catalog_product_allowed(p_product_id,'catalog.products.media') THEN
  RAISE EXCEPTION 'PRODUCT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO p FROM public.products WHERE id = p_product_id;
 PERFORM private.lock_catalog_store(p.store_id,'catalog.products.media');
 SELECT count(*) INTO n FROM public.product_images WHERE product_id = p_product_id;
 IF p_image_ids IS NULL OR cardinality(p_image_ids) <> n
 OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_image_ids) e(id) WHERE e.id IS NULL)
 OR (SELECT count(DISTINCT e.id) FROM pg_catalog.unnest(p_image_ids) e(id)) <> n
 OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_image_ids) e(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.product_images i WHERE i.id = e.id AND i.product_id = p_product_id)) THEN
  RAISE EXCEPTION 'INVALID_IMAGE_ORDER' USING ERRCODE = '22023'; END IF;
 SET CONSTRAINTS public.product_images_position DEFERRED;
 UPDATE public.product_images i SET sort_order = (e.pos - 1)::smallint
 FROM pg_catalog.unnest(p_image_ids) WITH ORDINALITY e(id,pos) WHERE i.id = e.id AND i.product_id = p_product_id;
 SET CONSTRAINTS public.product_images_position IMMEDIATE;
 RETURN pg_catalog.jsonb_build_object('product_id',p_product_id,'count',n);
END;
$$;


CREATE FUNCTION private.can_manage_product_media(p_bucket text, p_path text, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_bucket = 'product-images' AND EXISTS (
  SELECT 1 FROM public.products p
  WHERE ARRAY[p.store_id,p.id] = private.product_media_location(p_path)
   AND private.catalog_product_allowed(p.id,p_permission)
 );
$$;

CREATE FUNCTION private.can_delete_product_media(p_bucket text, p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE loc uuid[]; s public.stores%ROWTYPE; p public.products%ROWTYPE;
BEGIN
 IF NOT private.can_manage_product_media(p_bucket,p_path,'catalog.products.media') THEN RETURN false; END IF;
 loc := private.product_media_location(p_path);
 SELECT * INTO s FROM public.stores WHERE id = loc[1] FOR UPDATE;
 IF NOT FOUND OR s.archived_at IS NOT NULL THEN RETURN false; END IF;
 SELECT * INTO p FROM public.products WHERE id = loc[2] AND store_id = loc[1];
 IF NOT FOUND OR p.archived_at IS NOT NULL THEN RETURN false; END IF;
 RETURN private.has_store_permission(s.id,'catalog.products.media') AND NOT EXISTS (
  SELECT 1 FROM public.product_images WHERE path = p_path
 );
END;
$$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('product-images','product-images',true,5242880,ARRAY['image/png','image/jpeg','image/webp']);
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
CREATE POLICY vibestore_product_media_read ON storage.objects FOR SELECT TO authenticated
USING(private.can_manage_product_media(bucket_id,name,'catalog.read'));
CREATE POLICY vibestore_product_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK(private.can_manage_product_media(bucket_id,name,'catalog.products.media'));
CREATE POLICY vibestore_product_media_delete ON storage.objects FOR DELETE TO authenticated
USING(private.can_delete_product_media(bucket_id,name));
-- Sem UPDATE de storage.objects: arquivos imutaveis; usar upsert=false.

CREATE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON public.categories
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER products_audit AFTER INSERT OR UPDATE OR DELETE ON public.products
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER product_images_audit AFTER INSERT OR UPDATE OR DELETE ON public.product_images
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER product_attributes_audit AFTER INSERT OR UPDATE OR DELETE ON public.product_attributes
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();

REVOKE ALL ON FUNCTION private.catalog_slug(text), private.next_catalog_code(uuid,text),
 private.product_media_location(text), private.lock_catalog_store(uuid,text),
 private.catalog_store_allowed(uuid,text), private.catalog_product_allowed(uuid,text),
 private.validate_category(), private.validate_product(), private.validate_product_image(),
 private.catalog_validate_input(jsonb,text[]), private.catalog_normalize_attributes(jsonb),
 private.can_manage_product_media(text,text,text), private.can_delete_product_media(text,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.product_media_location(text),
 private.catalog_store_allowed(uuid,text), private.catalog_product_allowed(uuid,text),
 private.can_manage_product_media(text,text,text), private.can_delete_product_media(text,text)
 TO authenticated;

REVOKE ALL ON FUNCTION public.create_category(uuid,uuid,jsonb), public.create_product(uuid,uuid,jsonb),
 public.update_category(uuid,jsonb), public.update_product(uuid,jsonb),
 public.replace_product_attributes(uuid,jsonb), public.archive_category(uuid), public.archive_product(uuid),
 public.attach_product_image(uuid,text,text), public.detach_product_image(uuid,uuid), public.reorder_product_images(uuid,uuid[])
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_category(uuid,uuid,jsonb), public.create_product(uuid,uuid,jsonb),
 public.update_category(uuid,jsonb), public.update_product(uuid,jsonb),
 public.replace_product_attributes(uuid,jsonb), public.archive_category(uuid), public.archive_product(uuid),
 public.attach_product_image(uuid,text,text), public.detach_product_image(uuid,uuid), public.reorder_product_images(uuid,uuid[])
 TO authenticated;
COMMIT;
