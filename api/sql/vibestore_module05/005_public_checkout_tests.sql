-- Modulo 05 / Testes SQL de desenvolvimento. Requer 001..005.
-- Fixtures sinteticas; nao testa gateway, HTTP, proxies ou WhatsApp real.
BEGIN;
CREATE TEMP TABLE checkout_context(key text PRIMARY KEY,value uuid NOT NULL);
GRANT SELECT,INSERT,UPDATE ON checkout_context TO authenticated,service_role;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a8111111-1111-4111-8111-111111111111','checkout-a@example.invalid','{}'),
 ('b8222222-2222-4222-8222-222222222222','checkout-b@example.invalid','{}');
SELECT set_config('request.jwt.claim.sub','a8111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"a8111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s uuid;p uuid;r jsonb;
BEGIN
 r:=public.create_store(gen_random_uuid(),(SELECT id FROM public.plans WHERE code='FREE'),
  '{"name":"Vitrine A","slug":"vitrine-a","whatsapp_number":"+12025550101"}');
 s:=(r ->> 'store_id')::uuid;INSERT INTO checkout_context VALUES('store',s);
 r:=public.create_product(s,gen_random_uuid(),'{"name":"Produto publico","price":25,"cost_price":999,"status":"ACTIVE"}');
 p:=(r ->> 'product_id')::uuid;INSERT INTO checkout_context VALUES('product',p);
 PERFORM public.register_inventory_movement(p,gen_random_uuid(),'ENTRY',10,'Estoque para checkout',10);
 r:=public.create_product(s,gen_random_uuid(),'{"name":"Produto inativo","price":1}');
 INSERT INTO checkout_context VALUES('inactive',(r ->> 'product_id')::uuid);
 PERFORM public.set_store_publication(s,true);
 BEGIN PERFORM public.get_public_catalog('vitrine-a');RAISE EXCEPTION 'FAIL: autenticado bypass Edge';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: loja preparada e RPC publica bloqueada ao cliente autenticado';
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.orders;RAISE EXCEPTION 'FAIL: anon le pedidos';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.get_public_catalog('vitrine-a');RAISE EXCEPTION 'FAIL: anon bypass Edge';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: anon nao acessa tabelas nem contorna a Edge Function';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;detail jsonb;p uuid;
BEGIN
 SELECT value INTO p FROM checkout_context WHERE key='product';
 r:=public.get_public_catalog('vitrine-a','{"search":"publico","in_stock":true,"page_size":1}');
 IF(r ->> 'total')::integer<>1 OR jsonb_array_length(r -> 'products')<>1 THEN RAISE EXCEPTION 'FAIL: busca/paginacao';END IF;
 IF (r -> 'products' -> 0) ? 'cost_price' OR (r -> 'products' -> 0) ? 'average_cost' THEN RAISE EXCEPTION 'FAIL: custo exposto';END IF;
 detail:=public.get_public_product('vitrine-a','produto-publico');
 IF detail ? 'cost_price' OR NOT(detail ->> 'in_stock')::boolean THEN RAISE EXCEPTION 'FAIL: detalhe publico';END IF;
 IF public.get_public_product('vitrine-a','produto-inativo') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: produto inativo exposto';END IF;
 RAISE NOTICE 'PASS: projecao publica, busca, filtros e nenhuma exposicao de custos';
END $$;

DO $$ DECLARE p uuid;r jsonb;retry jsonb;input jsonb;
BEGIN
 SELECT value INTO p FROM checkout_context WHERE key='product';
 input:=jsonb_build_object('customer',jsonb_build_object('full_name','Cliente Original','phone','+12025550102'),
  'address','{"postal_code":"01001000","street":"Rua Teste","number":"1","district":"Centro","city":"Sao Paulo","state":"SP"}'::jsonb,
  'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',7)));
 r:=public.create_public_order('vitrine-a','81000000-0000-4000-8000-000000000001',input,repeat('a',64));
 INSERT INTO checkout_context VALUES('order',(r ->> 'order_id')::uuid);
 IF(r ->> 'subtotal')::numeric<>175 OR r ->> 'status'<>'PENDING' THEN RAISE EXCEPTION 'FAIL: total/status';END IF;
 retry:=public.create_public_order('vitrine-a','81000000-0000-4000-8000-000000000001',input,repeat('a',64));
 IF NOT(retry ->> 'replayed')::boolean OR retry ->> 'order_id'<>r ->> 'order_id' THEN RAISE EXCEPTION 'FAIL: replay pedido';END IF;
 BEGIN PERFORM public.create_public_order('vitrine-a','81000000-0000-4000-8000-000000000001',input || '{"note":"Alterado"}',repeat('a',64));
 RAISE EXCEPTION 'FAIL: replay com dados diferentes';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.create_public_order('vitrine-a',gen_random_uuid(),input || jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',4))),repeat('b',64));
 RAISE EXCEPTION 'FAIL: estoque reservado vendido novamente';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.create_public_order('vitrine-a',gen_random_uuid(),input || jsonb_build_object('items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit_price',0))),repeat('b',64));
 RAISE EXCEPTION 'FAIL: preco enviado pelo navegador aceito';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.create_public_order('vitrine-a',gen_random_uuid(),input || jsonb_build_object('customer',jsonb_build_object('full_name','Nome autodeclarado diferente','phone','+12025550102'),
  'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1))),repeat('b',64));
 IF EXISTS(SELECT 1 FROM public.customers WHERE phone='+12025550102' AND full_name<>'Cliente Original') THEN
 RAISE EXCEPTION 'FAIL: telefone sobrescreveu cadastro anterior';END IF;
 IF public.get_public_order_status('vitrine-a',(SELECT value FROM checkout_context WHERE key='order'),repeat('c',64)) IS NOT NULL THEN
 RAISE EXCEPTION 'FAIL: token errado acessa pedido';END IF;
 IF public.get_public_order_status('outra-loja',(SELECT value FROM checkout_context WHERE key='order'),repeat('a',64)) IS NOT NULL THEN
 RAISE EXCEPTION 'FAIL: loja errada acessa pedido';END IF;
 r:=public.get_public_order_status('vitrine-a',(SELECT value FROM checkout_context WHERE key='order'),repeat('a',64));
 IF r IS NULL OR r ? 'unit_cost_snapshot' OR(r -> 'items' -> 0) ? 'unit_cost_snapshot' THEN RAISE EXCEPTION 'FAIL: acompanhamento/custo';END IF;
 IF NOT(r ->> 'reservation_active')::boolean THEN RAISE EXCEPTION 'FAIL: reserva';END IF;
 RAISE NOTICE 'PASS: pedido atomico, preco do servidor, replay, reserva e privacidade de cliente/token';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE p uuid;n integer;
BEGIN
 SELECT value INTO p FROM checkout_context WHERE key='product';
 IF NOT EXISTS(SELECT 1 FROM public.product_stock_balances WHERE product_id=p AND quantity=10 AND reserved_quantity=8 AND available_quantity=2) THEN
 RAISE EXCEPTION 'FAIL: fisico/reservado/disponivel';END IF;
 BEGIN PERFORM public.register_inventory_movement(p,gen_random_uuid(),'EXIT',3,'Saida conflitante');
 RAISE EXCEPTION 'FAIL: saida consumiu estoque reservado';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=p AND quantity=10) THEN RAISE EXCEPTION 'FAIL: saldo mudou apos falha';END IF;
 BEGIN UPDATE public.orders SET status='PAID';RAISE EXCEPTION 'FAIL: pagamento direto';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: reserva bloqueia saida/ajuste/reversao que reduz saldo abaixo da reserva';
END $$;
RESET ROLE;
-- Expiracao simulada: nao ocorre baixa fisica nem cancelamento automatico.
UPDATE public.inventory_reservations SET expires_at=clock_timestamp()-interval '1 second';
DO $$ DECLARE p uuid;r jsonb;
BEGIN
 SELECT value INTO p FROM checkout_context WHERE key='product';
 IF private.active_reserved_quantity(p)<>0 THEN RAISE EXCEPTION 'FAIL: reserva expirada continua bloqueando';END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE p uuid;
BEGIN
 SELECT value INTO p FROM checkout_context WHERE key='product';
 IF NOT EXISTS(SELECT 1 FROM public.product_stock_balances WHERE product_id=p AND quantity=10 AND reserved_quantity=0 AND available_quantity=10) THEN
 RAISE EXCEPTION 'FAIL: expiracao nao libera disponivel';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.orders WHERE status='PENDING') THEN RAISE EXCEPTION 'FAIL: pedido cancelado automaticamente';END IF;
 RAISE NOTICE 'PASS: reserva expira sem movimento fisico ou alteracao silenciosa de status';
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;
BEGIN
 r:=public.consume_public_rate_limit('catalog',repeat('f',64),2,60);
 IF NOT(r ->> 'allowed')::boolean THEN RAISE EXCEPTION 'FAIL: primeira quota';END IF;
 r:=public.consume_public_rate_limit('catalog',repeat('f',64),2,60);
 IF NOT(r ->> 'allowed')::boolean THEN RAISE EXCEPTION 'FAIL: segunda quota';END IF;
 r:=public.consume_public_rate_limit('catalog',repeat('f',64),2,60);
 IF(r ->> 'allowed')::boolean THEN RAISE EXCEPTION 'FAIL: terceira quota aceita';END IF;
 RAISE NOTICE 'PASS: rate limit atomico e permissao exclusiva service_role';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b8222222-2222-4222-8222-222222222222',true);
SELECT set_config('request.jwt.claims','{"sub":"b8222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM public.orders;
 IF n<>0 THEN RAISE EXCEPTION 'FAIL: outra conta le pedidos';END IF;
 SELECT count(*) INTO n FROM public.customers;
 IF n<>0 THEN RAISE EXCEPTION 'FAIL: outra conta le clientes';END IF;
 RAISE NOTICE 'PASS: RLS privada de pedidos e clientes';
END $$;
RESET ROLE;
UPDATE public.permissions SET is_active=false WHERE code='orders.create';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.get_public_catalog('vitrine-a') IS NULL THEN RAISE EXCEPTION 'FAIL: desativar checkout desligou catalogo';END IF;
 BEGIN PERFORM public.create_public_order('vitrine-a',gen_random_uuid(),'{}',repeat('d',64));
 RAISE EXCEPTION 'FAIL: permissao checkout desativada';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 RAISE NOTICE 'PASS: checkout desativavel sem desligar catalogo';
END $$;
RESET ROLE;
UPDATE public.profiles SET is_active=false WHERE id='a8111111-1111-4111-8111-111111111111';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.get_public_catalog('vitrine-a') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: loja suspensa publica';END IF;
 RAISE NOTICE 'PASS: suspensao do lojista interrompe vitrine';
END $$;
RESET ROLE;
ROLLBACK;
