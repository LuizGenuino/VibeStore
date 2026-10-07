-- VibeStore / Modulo 02: plano gratuito, loja e identidade visual
-- Dependencia: 001_identity_rbac.sql (versao do reinicio).
-- Executar UMA VEZ em Supabase de desenvolvimento. Nao usar o schema antigo.
-- Escopo: uma loja NAO arquivada por proprietario; nenhum gateway/assinatura paga.
-- Buckets publicos SOMENTE para midia de marca. Nao armazenar documentos/PII.
BEGIN;

CREATE FUNCTION private.valid_social_links(p_links jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_links IS NULL OR pg_catalog.jsonb_typeof(p_links) <> 'object' THEN RETURN false; END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_each(p_links) e
    WHERE e.key NOT IN ('instagram', 'facebook', 'tiktok', 'youtube', 'website')
       OR pg_catalog.jsonb_typeof(e.value) <> 'string'
       OR pg_catalog.char_length(e.value #>> '{}') > 2048
       OR (e.value #>> '{}') !~ '^https://[^[:space:]]+$'
  );
END;
$$;

CREATE FUNCTION private.store_id_from_media_path(p_path text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_path IS NULL OR p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$' THEN RETURN NULL; END IF;
  v_id := pg_catalog.split_part(p_path, '/', 1)::uuid;
  -- Valida tambem o UUID do arquivo, nao apenas o UUID da pasta.
  PERFORM pg_catalog.split_part(pg_catalog.split_part(p_path, '/', 2), '.', 1)::uuid;
  RETURN v_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  price numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_current_code CHECK (code = 'FREE'),
  CONSTRAINT plans_current_price CHECK (price = 0 AND currency = 'BRL')
);
COMMENT ON TABLE public.plans IS 'Somente FREE nesta versao. Novos planos exigem migration propria; nao existe cobranca.';
INSERT INTO public.plans (code, name, description)
VALUES ('FREE', 'Gratuito', 'Todos os recursos implementados nesta versao, respeitando permissoes e limites operacionais.');

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.plans(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  subtitle text NOT NULL DEFAULT '' CHECK (char_length(subtitle) <= 300),
  slug text NOT NULL,
  cnpj text CHECK (cnpj IS NULL OR char_length(cnpj) BETWEEN 1 AND 32),
  email text CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  whatsapp_number text NOT NULL CHECK (whatsapp_number ~ '^\+[1-9][0-9]{7,14}$'),
  logo_path text,
  banner_path text,
  primary_color text NOT NULL DEFAULT '#6750A4' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#03A9F4' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (private.valid_social_links(social_links)),
  is_published boolean NOT NULL DEFAULT false,
  onboarding_request_id uuid NOT NULL,
  onboarding_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT stores_slug_key UNIQUE (slug),
  CONSTRAINT stores_onboarding_key UNIQUE (owner_id, onboarding_request_id),
  CONSTRAINT stores_slug_format CHECK (
    char_length(slug) BETWEEN 3 AND 63
    AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND slug NOT IN ('admin', 'api', 'app', 'auth', 'login', 'signup', 'dashboard', 'settings', 'sudo', 'supabase')
  ),
  CONSTRAINT stores_logo_path CHECK (logo_path IS NULL OR COALESCE(private.store_id_from_media_path(logo_path) = id, false)),
  CONSTRAINT stores_banner_path CHECK (banner_path IS NULL OR COALESCE(private.store_id_from_media_path(banner_path) = id, false)),
  CONSTRAINT stores_archived_unpublished CHECK (archived_at IS NULL OR NOT is_published)
);
-- COALESCE(false) nos CHECKs impede aceitar caminhos malformados que retornem NULL.
CREATE UNIQUE INDEX stores_one_live_per_owner ON public.stores(owner_id) WHERE archived_at IS NULL;
CREATE INDEX stores_plan_idx ON public.stores(plan_id);
CREATE INDEX stores_public_slug_idx ON public.stores(slug) WHERE is_published AND archived_at IS NULL;
COMMENT ON COLUMN public.stores.cnpj IS 'Campo opcional textual; nao e validacao fiscal. Aceita formatos numericos/alfanumericos.';
COMMENT ON COLUMN public.stores.is_published IS 'Publicacao explicita. Nova loja inicia como rascunho.';
COMMENT ON COLUMN public.stores.onboarding_payload IS 'Entrada original para idempotencia; nao alterar via cliente.';
COMMENT ON COLUMN public.stores.slug IS 'Unico inclusive apos arquivamento, para nao transferir URLs antigas silenciosamente.';

CREATE TRIGGER plans_touch BEFORE UPDATE ON public.plans
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER stores_touch BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- A migration adiciona definicoes de sistema. O painel nao tem essa capacidade.
ALTER TABLE public.permissions DISABLE TRIGGER permissions_protect;
INSERT INTO public.permissions (code, module, description, is_system) VALUES
 ('plans.read', 'plans', 'Consultar plano gratuito disponivel.', true),
 ('plans.manage', 'plans', 'SUDO: editar nome, descricao e disponibilidade do plano.', true),
 ('store.create', 'store', 'Criar a primeira loja ativa pelo onboarding.', true),
 ('store.read', 'store', 'Consultar a loja autorizada.', true),
 ('store.update', 'store', 'Editar dados e personalizacao da loja.', true),
 ('store.publish', 'store', 'Publicar ou despublicar a loja.', true),
 ('store.archive', 'store', 'Arquivar a loja.', true),
 ('store.branding.manage', 'store', 'Enviar, vincular e remover logo/banner.', true),
 ('store.admin', 'store', 'SUDO: administrar lojas de outros proprietarios.', true);
ALTER TABLE public.permissions ENABLE TRIGGER permissions_protect;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE p.code IN ('plans.read', 'plans.manage', 'store.create', 'store.read', 'store.update',
 'store.publish', 'store.archive', 'store.branding.manage', 'store.admin')
AND (
 r.code = 'SUDO'
 OR (r.code = 'USER' AND p.code IN ('plans.read', 'store.create'))
 OR (r.code = 'OWNER' AND p.code IN ('plans.read', 'store.read', 'store.update', 'store.publish', 'store.archive', 'store.branding.manage'))
);

-- OWNER e contextual. Nao sera inserido em user_platform_roles.
-- Nenhuma consulta aceita um user_id escolhido pelo cliente.
CREATE FUNCTION private.has_store_permission(p_store_id uuid, p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT private.account_is_active()
  AND private.has_global_permission('auth.access')
  AND EXISTS (
   SELECT 1 FROM public.stores s
   JOIN public.roles r ON r.is_active AND (
     (r.code = 'OWNER' AND s.owner_id = auth.uid())
     OR (r.code = 'SUDO' AND private.is_sudo() AND private.has_global_permission('store.admin'))
   )
   JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_enabled
   JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active
   WHERE s.id = p_store_id AND p.code = p_code
  );
$$;

CREATE FUNCTION private.can_manage_store_media(p_bucket text, p_path text, p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_bucket IN ('store-logos', 'store-banners') AND EXISTS (
  SELECT 1 FROM public.stores s
  WHERE s.id = private.store_id_from_media_path(p_path)
    AND s.archived_at IS NULL
    AND private.has_store_permission(s.id, p_permission)
 );
$$;

CREATE FUNCTION private.can_delete_store_media(p_bucket text, p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store public.stores%ROWTYPE;
BEGIN
 IF NOT private.can_manage_store_media(p_bucket, p_path, 'store.branding.manage') THEN RETURN false; END IF;
 -- Serializa desvinculacao/vinculacao com DELETE do objeto.
 SELECT * INTO v_store FROM public.stores
 WHERE id = private.store_id_from_media_path(p_path) FOR UPDATE;
 IF NOT FOUND OR v_store.archived_at IS NOT NULL THEN RETURN false; END IF;
 RETURN NOT ((p_bucket = 'store-logos' AND COALESCE(v_store.logo_path = p_path, false))
          OR (p_bucket = 'store-banners' AND COALESCE(v_store.banner_path = p_path, false)));
END;
$$;

-- Validacao de referencias, publicacao e branding, inclusive updates via API.
CREATE FUNCTION private.validate_store_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND auth.role() = 'authenticated' THEN
  IF NEW.is_published IS DISTINCT FROM OLD.is_published
     AND NOT private.has_store_permission(OLD.id, 'store.publish') THEN
   RAISE EXCEPTION 'STORE_PUBLISH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF (NEW.logo_path IS DISTINCT FROM OLD.logo_path OR NEW.banner_path IS DISTINCT FROM OLD.banner_path)
     AND NOT private.has_store_permission(OLD.id, 'store.branding.manage') THEN
   RAISE EXCEPTION 'STORE_BRANDING_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
 END IF;
 IF NEW.logo_path IS NOT NULL THEN
  IF private.store_id_from_media_path(NEW.logo_path) IS DISTINCT FROM NEW.id THEN
   RAISE EXCEPTION 'INVALID_LOGO_PATH' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM storage.objects o
  WHERE o.bucket_id = 'store-logos' AND o.name = NEW.logo_path FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOGO_OBJECT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
 END IF;
 IF NEW.banner_path IS NOT NULL THEN
  IF private.store_id_from_media_path(NEW.banner_path) IS DISTINCT FROM NEW.id THEN
   RAISE EXCEPTION 'INVALID_BANNER_PATH' USING ERRCODE = '23514'; END IF;
  PERFORM 1 FROM storage.objects o
  WHERE o.bucket_id = 'store-banners' AND o.name = NEW.banner_path FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BANNER_OBJECT_NOT_FOUND' USING ERRCODE = '23503'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER stores_validate BEFORE INSERT OR UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION private.validate_store_update();

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.plans, public.stores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plans, public.stores TO authenticated;
GRANT UPDATE (name, description, is_active) ON public.plans TO authenticated;
GRANT UPDATE (name, title, subtitle, slug, cnpj, email, whatsapp_number, logo_path,
 banner_path, primary_color, secondary_color, social_links, is_published)
 ON public.stores TO authenticated;
GRANT ALL ON public.plans, public.stores TO service_role;

CREATE POLICY plans_select ON public.plans FOR SELECT TO authenticated
USING ((is_active AND (SELECT private.has_global_permission('plans.read')))
 OR ((SELECT private.is_sudo()) AND (SELECT private.has_global_permission('plans.manage'))
     AND (SELECT private.has_global_permission('auth.access'))));
CREATE POLICY plans_update_sudo ON public.plans FOR UPDATE TO authenticated
USING ((SELECT private.is_sudo()) AND (SELECT private.has_global_permission('plans.manage'))
 AND (SELECT private.has_global_permission('auth.access')))
WITH CHECK ((SELECT private.is_sudo()) AND (SELECT private.has_global_permission('plans.manage'))
 AND (SELECT private.has_global_permission('auth.access')));
CREATE POLICY stores_select ON public.stores FOR SELECT TO authenticated
USING (archived_at IS NULL AND private.has_store_permission(id, 'store.read'));
CREATE POLICY stores_update ON public.stores FOR UPDATE TO authenticated
USING (archived_at IS NULL AND private.has_store_permission(id, 'store.update'))
WITH CHECK (archived_at IS NULL AND private.has_store_permission(id, 'store.update'));
-- Sem INSERT/DELETE do cliente. Criacao/arquivamento somente por RPC.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
 ('store-logos', 'store-logos', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp']),
 ('store-banners', 'store-banners', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp']);
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

CREATE POLICY vibestore_branding_select ON storage.objects FOR SELECT TO authenticated
USING (private.can_manage_store_media(bucket_id, name, 'store.read'));
CREATE POLICY vibestore_branding_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (private.can_manage_store_media(bucket_id, name, 'store.branding.manage'));
CREATE POLICY vibestore_branding_delete ON storage.objects FOR DELETE TO authenticated
USING (private.can_delete_store_media(bucket_id, name));
-- Sem UPDATE: uploads imutaveis com nome UUID e upsert=false.
-- Public=true libera download por URL, NAO upload/listagem/remocao anonimos.


CREATE FUNCTION public.create_store(p_request_id uuid, p_plan_id uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_user uuid := auth.uid(); v_store public.stores%ROWTYPE;
 v_name text; v_title text; v_subtitle text; v_slug text; v_whatsapp text;
 v_cnpj text; v_email text; v_primary text; v_secondary text; v_social jsonb;
 v_payload jsonb; v_constraint text;
BEGIN
 IF v_user IS NULL OR NOT private.has_global_permission('auth.access')
    OR NOT private.has_global_permission('store.create') THEN
  RAISE EXCEPTION 'STORE_CREATE_FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 IF p_request_id IS NULL OR p_plan_id IS NULL THEN
  RAISE EXCEPTION 'REQUEST_AND_PLAN_REQUIRED' USING ERRCODE = '22004';
 END IF;
 IF p_input IS NULL OR pg_catalog.jsonb_typeof(p_input) <> 'object'
    OR pg_catalog.pg_column_size(p_input) > 16384 THEN
  RAISE EXCEPTION 'INVALID_STORE_INPUT' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_input) k(key)
  WHERE k.key NOT IN ('name', 'title', 'subtitle', 'slug', 'whatsapp_number', 'cnpj',
   'email', 'primary_color', 'secondary_color', 'social_links')) THEN
  RAISE EXCEPTION 'UNKNOWN_STORE_FIELD' USING ERRCODE = '22023';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_input) e
  WHERE e.key <> 'social_links' AND pg_catalog.jsonb_typeof(e.value) NOT IN ('string', 'null')) THEN
  RAISE EXCEPTION 'INVALID_STORE_FIELD_TYPE' USING ERRCODE = '22023';
 END IF;
 v_name := pg_catalog.btrim(p_input ->> 'name');
 v_title := COALESCE(NULLIF(pg_catalog.btrim(p_input ->> 'title'), ''), v_name);
 v_subtitle := COALESCE(pg_catalog.btrim(p_input ->> 'subtitle'), '');
 v_slug := pg_catalog.lower(pg_catalog.btrim(p_input ->> 'slug'));
 v_whatsapp := pg_catalog.btrim(p_input ->> 'whatsapp_number');
 v_cnpj := NULLIF(pg_catalog.btrim(p_input ->> 'cnpj'), '');
 v_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_input ->> 'email')), '');
 v_primary := pg_catalog.upper(COALESCE(NULLIF(pg_catalog.btrim(p_input ->> 'primary_color'), ''), '#6750A4'));
 v_secondary := pg_catalog.upper(COALESCE(NULLIF(pg_catalog.btrim(p_input ->> 'secondary_color'), ''), '#03A9F4'));
 v_social := COALESCE(p_input -> 'social_links', '{}'::jsonb);
 IF v_name IS NULL OR pg_catalog.char_length(v_name) NOT BETWEEN 2 AND 120
    OR v_title IS NULL OR pg_catalog.char_length(v_title) NOT BETWEEN 2 AND 160 THEN
  RAISE EXCEPTION 'INVALID_STORE_NAME_OR_TITLE' USING ERRCODE = '22023';
 END IF;
 IF v_slug IS NULL OR pg_catalog.char_length(v_slug) NOT BETWEEN 3 AND 63
    OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR v_slug IN ('admin', 'api', 'app', 'auth', 'login', 'signup', 'dashboard', 'settings', 'sudo', 'supabase') THEN
  RAISE EXCEPTION 'INVALID_STORE_SLUG' USING ERRCODE = '22023';
 END IF;
 IF v_whatsapp IS NULL OR v_whatsapp !~ '^\+[1-9][0-9]{7,14}$' THEN
  RAISE EXCEPTION 'INVALID_WHATSAPP_NUMBER' USING ERRCODE = '22023';
 END IF;
 IF NOT private.valid_social_links(v_social) THEN
  RAISE EXCEPTION 'INVALID_SOCIAL_LINKS' USING ERRCODE = '22023';
 END IF;
 v_payload := pg_catalog.jsonb_build_object(
  'plan_id', p_plan_id, 'name', v_name, 'title', v_title, 'subtitle', v_subtitle,
  'slug', v_slug, 'whatsapp_number', v_whatsapp, 'cnpj', v_cnpj, 'email', v_email,
  'primary_color', v_primary, 'secondary_color', v_secondary, 'social_links', v_social
 );
 -- Serializa duas tentativas de onboarding para o mesmo usuario.
 PERFORM 1 FROM public.profiles WHERE id = v_user AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO v_store FROM public.stores
 WHERE owner_id = v_user AND onboarding_request_id = p_request_id;
 IF FOUND THEN
  IF v_store.onboarding_payload IS DISTINCT FROM v_payload THEN
   RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED' USING ERRCODE = '22023';
  END IF;
  IF v_store.archived_at IS NOT NULL THEN
   RAISE EXCEPTION 'ONBOARDING_ALREADY_ARCHIVED' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.jsonb_build_object('store_id', v_store.id, 'slug', v_store.slug,
   'plan_id', v_store.plan_id, 'created', false);
 END IF;
 IF EXISTS (SELECT 1 FROM public.stores WHERE owner_id = v_user AND archived_at IS NULL) THEN
  RAISE EXCEPTION 'ACTIVE_STORE_ALREADY_EXISTS' USING ERRCODE = '23505';
 END IF;
 PERFORM 1 FROM public.plans WHERE id = p_plan_id AND code = 'FREE' AND price = 0 AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_UNAVAILABLE' USING ERRCODE = '22023'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_enabled
  JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE r.code = 'OWNER' AND r.is_active AND p.code = 'store.read'
 ) THEN RAISE EXCEPTION 'OWNER_ACCESS_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 INSERT INTO public.stores (owner_id, plan_id, name, title, subtitle, slug, whatsapp_number,
  cnpj, email, primary_color, secondary_color, social_links, onboarding_request_id, onboarding_payload)
 VALUES (v_user, p_plan_id, v_name, v_title, v_subtitle, v_slug, v_whatsapp,
  v_cnpj, v_email, v_primary, v_secondary, v_social, p_request_id, v_payload)
 RETURNING * INTO v_store;
 RETURN pg_catalog.jsonb_build_object('store_id', v_store.id, 'slug', v_store.slug,
  'plan_id', v_store.plan_id, 'created', true);
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
 IF v_constraint = 'stores_slug_key' THEN
  RAISE EXCEPTION 'SLUG_ALREADY_EXISTS' USING ERRCODE = '23505';
 END IF;
 IF v_constraint = 'stores_one_live_per_owner' THEN
  RAISE EXCEPTION 'ACTIVE_STORE_ALREADY_EXISTS' USING ERRCODE = '23505';
 END IF;
 RAISE;
END;
$$;

CREATE FUNCTION public.get_store_access(p_store_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.archived_at IS NULL
   AND private.has_store_permission(s.id, 'store.read')
 ) THEN NULL ELSE pg_catalog.jsonb_build_object(
  'store_id', p_store_id,
  'role', CASE WHEN EXISTS (SELECT 1 FROM public.stores s WHERE s.id = p_store_id AND s.owner_id = auth.uid())
    THEN 'OWNER' ELSE 'SUDO' END,
  'permissions', COALESCE((
   SELECT pg_catalog.jsonb_agg(p.code ORDER BY p.code)
   FROM public.permissions p WHERE p.is_active
    AND private.has_store_permission(p_store_id, p.code)
  ), '[]'::jsonb)
 ) END;
$$;

-- So informa disponibilidade ao usuario autenticado com permissao de criar loja.
-- Nao e uma consulta publica e nao garante reserva do slug.
CREATE FUNCTION public.check_store_slug(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_slug text := pg_catalog.lower(pg_catalog.btrim(p_slug));
BEGIN
 IF NOT private.has_global_permission('auth.access') OR NOT private.has_global_permission('store.create') THEN
  RAISE EXCEPTION 'STORE_CREATE_FORBIDDEN' USING ERRCODE = '42501'; END IF;
 IF v_slug IS NULL OR pg_catalog.char_length(v_slug) NOT BETWEEN 3 AND 63
 OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
 OR v_slug IN ('admin', 'api', 'app', 'auth', 'login', 'signup', 'dashboard', 'settings', 'sudo', 'supabase') THEN
  RETURN pg_catalog.jsonb_build_object('valid', false, 'available', false);
 END IF;
 RETURN pg_catalog.jsonb_build_object('valid', true, 'available',
  NOT EXISTS (SELECT 1 FROM public.stores WHERE slug = v_slug));
END;
$$;

CREATE FUNCTION public.set_store_publication(p_store_id uuid, p_published boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store public.stores%ROWTYPE;
BEGIN
 IF p_published IS NULL THEN RAISE EXCEPTION 'PUBLICATION_REQUIRED' USING ERRCODE = '22004'; END IF;
 IF NOT private.has_store_permission(p_store_id, 'store.publish') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
 IF NOT FOUND OR v_store.archived_at IS NOT NULL
    OR NOT private.has_store_permission(p_store_id, 'store.publish') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 UPDATE public.stores SET is_published = p_published WHERE id = p_store_id;
 RETURN pg_catalog.jsonb_build_object('store_id', p_store_id, 'is_published', p_published);
END;
$$;

CREATE FUNCTION public.archive_store(p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_store public.stores%ROWTYPE;
BEGIN
 IF NOT private.has_store_permission(p_store_id, 'store.archive') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 SELECT * INTO v_store FROM public.stores WHERE id = p_store_id FOR UPDATE;
 IF NOT FOUND OR NOT private.has_store_permission(p_store_id, 'store.archive') THEN
  RAISE EXCEPTION 'STORE_UNAVAILABLE' USING ERRCODE = '42501'; END IF;
 IF v_store.archived_at IS NOT NULL THEN
  RETURN pg_catalog.jsonb_build_object('store_id', p_store_id, 'archived', true, 'already_archived', true);
 END IF;
 UPDATE public.stores SET is_published = false, archived_at = pg_catalog.now() WHERE id = p_store_id;
 RETURN pg_catalog.jsonb_build_object('store_id', p_store_id, 'archived', true, 'already_archived', false);
END;
$$;

-- As alteracoes da loja e do plano sao auditadas. Ainda sem painel de auditoria.
CREATE TRIGGER stores_audit AFTER INSERT OR UPDATE OR DELETE ON public.stores
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER plans_audit AFTER INSERT OR UPDATE OR DELETE ON public.plans
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();

REVOKE ALL ON FUNCTION private.valid_social_links(jsonb), private.store_id_from_media_path(text),
 private.has_store_permission(uuid, text), private.can_manage_store_media(text, text, text),
 private.can_delete_store_media(text, text), private.validate_store_update()
 FROM PUBLIC, anon, authenticated;
-- Helpers utilizados por CHECK/policies precisam de EXECUTE, mas private nao e schema exposto.
GRANT EXECUTE ON FUNCTION private.valid_social_links(jsonb), private.store_id_from_media_path(text),
 private.has_store_permission(uuid, text), private.can_manage_store_media(text, text, text),
 private.can_delete_store_media(text, text)
 TO authenticated;
REVOKE ALL ON FUNCTION public.create_store(uuid, uuid, jsonb), public.get_store_access(uuid),
 public.check_store_slug(text), public.set_store_publication(uuid, boolean), public.archive_store(uuid)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_store(uuid, uuid, jsonb), public.get_store_access(uuid),
 public.check_store_slug(text), public.set_store_publication(uuid, boolean), public.archive_store(uuid)
 TO authenticated;

COMMIT;
