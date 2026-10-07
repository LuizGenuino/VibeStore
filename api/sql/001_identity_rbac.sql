-- VibeStore Reinicio / Modulo 01: identidade e RBAC
-- Aplicar UMA VEZ em projeto Supabase NOVO via migration ou SQL Editor.
-- Nao misturar com vibestore_schema.sql anterior. Nenhum DROP destrutivo.
-- Este modulo NAO cria lojas, planos, clientes, pedidos ou buckets.
-- Senha/email sao administrados exclusivamente por Supabase Auth.
-- SECURITY DEFINER: owner esperado postgres; private NAO deve ser schema exposto.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '' CHECK (char_length(full_name) <= 120),
  phone text CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_path text CHECK (avatar_path IS NULL OR char_length(avatar_path) <= 512),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.profiles.phone IS 'Telefone internacional E.164. Nao e uma credencial de autenticacao.';
COMMENT ON COLUMN public.profiles.avatar_path IS 'Caminho relativo no Storage; bucket/policies em etapa propria.';

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_]{1,49}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_.]{2,99}$'),
  module text NOT NULL CHECK (char_length(module) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_idx ON public.role_permissions(permission_id);

-- Somente papeis GLOBAIS. OWNER sera calculado por loja no modulo 02.
-- Conceder SUDO nunca sera uma operacao da API/painel.
CREATE TABLE public.user_platform_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.roles(code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code),
  CONSTRAINT platform_role_codes CHECK (role_code IN ('USER', 'SUDO'))
);
CREATE INDEX user_platform_roles_role_idx ON public.user_platform_roles(role_code);

CREATE TABLE public.security_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_before jsonb,
  row_after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_audit_logs_created_idx ON public.security_audit_logs(created_at DESC);
COMMENT ON COLUMN public.security_audit_logs.actor_id IS 'auth.uid(); NULL para migracoes/SQL Editor sem JWT. Historico preservado apos exclusao do usuario.';

INSERT INTO public.roles (code, name, description, is_system) VALUES
 ('USER', 'Usuario', 'Usuario autenticado; sem autoridade sobre lojas de terceiros.', true),
 ('OWNER', 'Proprietario', 'Autoridade limitada a loja de sua propriedade (modulo 02).', true),
 ('SUDO', 'Administrador da plataforma', 'Administracao interna. Atribuicao somente no Supabase.', true);

INSERT INTO public.permissions (code, module, description, is_system) VALUES
 ('auth.access', 'auth', 'Acessar area autenticada da aplicacao.', true),
 ('profile.update', 'profile', 'Editar o proprio perfil.', true),
 ('security.manage', 'security', 'Indicador de acesso ao painel interno de seguranca.', true);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code = 'SUDO'
   OR (r.code IN ('USER', 'OWNER') AND p.code IN ('auth.access', 'profile.update'));

CREATE FUNCTION private.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER roles_touch BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER permissions_touch BEFORE UPDATE ON public.permissions
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER role_permissions_touch BEFORE UPDATE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Protege contratos internos; registros customizados continuam com CRUD.
CREATE FUNCTION private.protect_security_definition()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system THEN
      RAISE EXCEPTION 'SYSTEM_DEFINITION_RESERVED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'SYSTEM_DEFINITION_CANNOT_BE_DELETED' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code
     OR NEW.is_system IS DISTINCT FROM OLD.is_system THEN
    RAISE EXCEPTION 'SECURITY_CODE_AND_SYSTEM_FLAG_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
-- Seeds de sistema foram inseridos antes destes triggers.
CREATE TRIGGER roles_protect BEFORE INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION private.protect_security_definition();
CREATE TRIGGER permissions_protect BEFORE INSERT OR UPDATE OR DELETE ON public.permissions
FOR EACH ROW EXECUTE FUNCTION private.protect_security_definition();

CREATE FUNCTION private.account_is_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_active
  );
$$;

CREATE FUNCTION private.is_sudo()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.account_is_active() AND EXISTS (
    SELECT 1 FROM public.user_platform_roles ur
    JOIN public.roles r ON r.code = ur.role_code
    WHERE ur.user_id = auth.uid() AND r.code = 'SUDO' AND r.is_active
  );
$$;

CREATE FUNCTION private.has_global_permission(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.account_is_active() AND EXISTS (
    SELECT 1 FROM public.user_platform_roles ur
    JOIN public.roles r ON r.code = ur.role_code AND r.is_active
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_enabled
    JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active
    WHERE ur.user_id = auth.uid() AND p.code = p_code
  );
$$;

CREATE FUNCTION private.can_manage_security()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_sudo()
    AND private.has_global_permission('security.manage')
    AND private.has_global_permission('auth.access');
$$;

-- Bootstrap nao confia em metadata para papeis, permissoes ou is_active.
CREATE FUNCTION private.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, pg_catalog.left(COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), 120));
  INSERT INTO public.user_platform_roles (user_id, role_code) VALUES (NEW.id, 'USER');
  RETURN NEW;
END;
$$;
CREATE TRIGGER vibestore_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

CREATE FUNCTION private.audit_security_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.security_audit_logs (actor_id, table_name, operation, row_before, row_after)
  VALUES (
    auth.uid(), TG_TABLE_NAME, TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roles_audit AFTER INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER permissions_audit AFTER INSERT OR UPDATE OR DELETE ON public.permissions
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER role_permissions_audit AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();
CREATE TRIGGER user_platform_roles_audit AFTER INSERT OR UPDATE OR DELETE ON public.user_platform_roles
FOR EACH ROW EXECUTE FUNCTION private.audit_security_change();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles, public.roles, public.permissions,
 public.role_permissions, public.user_platform_roles, public.security_audit_logs
 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, avatar_path) ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles, public.permissions, public.role_permissions TO authenticated;
GRANT SELECT ON public.user_platform_roles, public.security_audit_logs TO authenticated;
GRANT ALL ON public.profiles, public.roles, public.permissions,
 public.role_permissions, public.user_platform_roles, public.security_audit_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.security_audit_logs_id_seq TO service_role;

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.can_manage_security()));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()) AND (SELECT private.has_global_permission('profile.update'))
       AND (SELECT private.has_global_permission('auth.access')))
WITH CHECK (id = (SELECT auth.uid()) AND (SELECT private.has_global_permission('profile.update'))
       AND (SELECT private.has_global_permission('auth.access')));

-- O painel exige SUDO ativo + security.manage + auth.access.
-- Desativar a propria permissao administrativa pode bloquear o painel.
-- Recuperacao de auto-bloqueio somente via SQL Editor.
CREATE POLICY roles_sudo ON public.roles FOR ALL TO authenticated
USING ((SELECT private.can_manage_security())) WITH CHECK ((SELECT private.can_manage_security()));
CREATE POLICY permissions_sudo ON public.permissions FOR ALL TO authenticated
USING ((SELECT private.can_manage_security())) WITH CHECK ((SELECT private.can_manage_security()));
CREATE POLICY role_permissions_sudo ON public.role_permissions FOR ALL TO authenticated
USING ((SELECT private.can_manage_security())) WITH CHECK ((SELECT private.can_manage_security()));
CREATE POLICY platform_roles_select ON public.user_platform_roles FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT private.can_manage_security()));
CREATE POLICY security_audit_select ON public.security_audit_logs FOR SELECT TO authenticated
USING ((SELECT private.can_manage_security()));

CREATE FUNCTION public.get_my_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object(
    'user_id', auth.uid(),
    'account_active', private.account_is_active(),
    'can_manage_security', private.can_manage_security(),
    'roles', COALESCE((
      SELECT pg_catalog.jsonb_agg(r.code ORDER BY r.code)
      FROM public.user_platform_roles ur JOIN public.roles r ON r.code = ur.role_code
      WHERE ur.user_id = auth.uid() AND r.is_active AND private.account_is_active()
    ), '[]'::jsonb),
    'permissions', COALESCE((
      SELECT pg_catalog.jsonb_agg(x.code ORDER BY x.code) FROM (
        SELECT DISTINCT p.code
        FROM public.user_platform_roles ur
        JOIN public.roles r ON r.code = ur.role_code AND r.is_active
        JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_enabled
        JOIN public.permissions p ON p.id = rp.permission_id AND p.is_active
        WHERE ur.user_id = auth.uid() AND private.account_is_active()
      ) x
    ), '[]'::jsonb)
  );
$$;

-- Funcao administrativa nao concede papeis e nunca e publica/anonima.
CREATE FUNCTION public.sudo_set_user_active(p_user_id uuid, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT private.can_manage_security() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'ACTIVE_REQUIRED' USING ERRCODE = '22004';
  END IF;
  IF p_user_id = auth.uid() AND NOT p_active THEN
    RAISE EXCEPTION 'CANNOT_DISABLE_SELF' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.to_jsonb(p) INTO v_before FROM public.profiles p
  WHERE p.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.profiles SET is_active = p_active WHERE id = p_user_id;
  SELECT pg_catalog.to_jsonb(p) INTO v_after FROM public.profiles p WHERE p.id = p_user_id;
  INSERT INTO public.security_audit_logs (actor_id, table_name, operation, row_before, row_after)
  VALUES (auth.uid(), 'profiles', 'UPDATE', v_before, v_after);
END;
$$;

REVOKE ALL ON FUNCTION private.touch_updated_at(), private.protect_security_definition(),
 private.handle_new_auth_user(), private.audit_security_change(),
 private.account_is_active(), private.is_sudo(), private.has_global_permission(text), private.can_manage_security()
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.account_is_active(), private.is_sudo(), private.has_global_permission(text), private.can_manage_security()
 TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_access(), public.sudo_set_user_active(uuid, boolean)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_access(), public.sudo_set_user_active(uuid, boolean)
 TO authenticated;

COMMIT;
