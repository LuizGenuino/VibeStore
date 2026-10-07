-- VibeStore / Modulo 06 / Homologacao SQL de desenvolvimento. Requer 001..006.
-- Usuarios/contatos sinteticos. Nenhum pagamento, frete ou reembolso real.
BEGIN;
CREATE TEMP TABLE order_ops_context(key text PRIMARY KEY,value uuid NOT NULL);
GRANT SELECT,INSERT,UPDATE ON order_ops_context TO authenticated,service_role;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('ac111111-1111-4111-8111-111111111111','ops-owner@example.invalid','{}'),
 ('bc222222-2222-4222-8222-222222222222','ops-other@example.invalid','{}'),
 ('cc333333-3333-4333-8333-333333333333','ops-sudo@example.invalid','{}');
INSERT INTO public.user_platform_roles(user_id,role_code) VALUES('cc333333-3333-4333-8333-333333333333','SUDO');
SELECT set_config('request.jwt.claim.sub','ac111111-1111-4111-8111-111111111111',true);
SELECT set_config('request.jwt.claims','{"sub":"ac111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE s uuid;p uuid;r jsonb;
BEGIN
 r:=public.create_store(gen_random_uuid(),(SELECT id FROM public.plans WHERE code='FREE'),
  '{"name":"Operacao A","slug":"operacao-a","whatsapp_number":"+12025550101"}');
 s:=(r ->> 'store_id')::uuid;INSERT INTO order_ops_context VALUES('store',s);
 r:=public.create_product(s,gen_random_uuid(),'{"name":"Produto operacao","price":20,"status":"ACTIVE"}');
 p:=(r ->> 'product_id')::uuid;INSERT INTO order_ops_context VALUES('product',p);
 PERFORM public.register_inventory_movement(p,gen_random_uuid(),'ENTRY',20,'Estoque para pedidos',10);
 PERFORM public.set_store_publication(s,true);
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE p uuid;input jsonb;r jsonb;i integer;
BEGIN
 SELECT value INTO p FROM order_ops_context WHERE key='product';
 input:=jsonb_build_object('customer',jsonb_build_object('full_name','Cliente Operacao','phone','+12025550102'),
  'address','{"postal_code":"01001000","street":"Rua Teste","number":"1","district":"Centro","city":"Sao Paulo","state":"SP"}'::jsonb,
  'items',jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2)));
 FOR i IN 1..6 LOOP
  r:=public.create_public_order('operacao-a',gen_random_uuid(),input,repeat(i::text,64));
  INSERT INTO order_ops_context VALUES('order_'||i,(r ->> 'order_id')::uuid);
 END LOOP;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.update_order_terms((SELECT value FROM order_ops_context WHERE key='order_6'),gen_random_uuid(),0,0,'Frete do teste de permissoes');
END $$;
RESET ROLE;
UPDATE public.permissions SET is_active=false WHERE code='inventory.exit';
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_6';
 BEGIN PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'PIX','Sem permissao de estoque');
  RAISE EXCEPTION 'FAIL: pagamento sem inventory.exit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o)
 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=o AND status='PENDING' AND revision=1)
 OR NOT EXISTS(SELECT 1 FROM public.inventory_reservations WHERE order_id=o AND state='HELD') THEN
  RAISE EXCEPTION 'FAIL: reserva/recibo/status alterados parcialmente';END IF;
 RAISE NOTICE 'PASS: pagamento requer inventory.exit e falha restaura reserva sem recibo';
END $$;
RESET ROLE;
UPDATE public.permissions SET is_active=true WHERE code='inventory.exit';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 PERFORM public.cancel_order((SELECT value FROM order_ops_context WHERE key='order_6'),gen_random_uuid(),1,'Encerrar teste de permissoes');
END $$;

DO $$ DECLARE o uuid;p uuid;r jsonb;retry jsonb;n integer;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_1';SELECT value INTO p FROM order_ops_context WHERE key='product';
 BEGIN PERFORM public.confirm_order_payment(o,gen_random_uuid(),0,40,'PIX','Recebimento antes do frete');
  RAISE EXCEPTION 'FAIL: pagamento antes de confirmar frete';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.update_order_terms(o,'ca000000-0000-4000-8000-000000000001',0,5,'Frete combinado com cliente');
 IF(r ->> 'total')::numeric<>45 OR(r ->> 'revision')::bigint<>1 THEN RAISE EXCEPTION 'FAIL: termos';END IF;
 BEGIN PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'PIX','Valor incorreto');
  RAISE EXCEPTION 'FAIL: recebimento parcial';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.confirm_order_payment(o,'ca000000-0000-4000-8000-000000000002',1,45,'PIX','Recebimento verificado','PIX-TESTE');
 IF r ->> 'status'<>'PAID' OR(r ->> 'revision')::bigint<>2 THEN RAISE EXCEPTION 'FAIL: pagamento';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=p AND quantity=18 AND stock_value=180) THEN RAISE EXCEPTION 'FAIL: baixa';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE order_id=o AND state='HELD') THEN RAISE EXCEPTION 'FAIL: reserva nao consumida';END IF;
 retry:=public.confirm_order_payment(o,'ca000000-0000-4000-8000-000000000002',1,45,'PIX','Recebimento verificado','PIX-TESTE');
 IF NOT(retry ->> 'replayed')::boolean THEN RAISE EXCEPTION 'FAIL: replay de pagamento';END IF;
 SELECT count(*) INTO n FROM public.order_payments WHERE order_id=o AND kind='RECEIPT';
 IF n<>1 THEN RAISE EXCEPTION 'FAIL: recibo duplicado';END IF;
 BEGIN PERFORM public.update_order_terms(o,gen_random_uuid(),2,99,'Alterar frete pago');
  RAISE EXCEPTION 'FAIL: termos depois de pago';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.reverse_inventory_movement((SELECT movement_id FROM public.order_stock_operations WHERE order_id=o AND kind='SALE'),gen_random_uuid(),'Reversao manual indevida');
  RAISE EXCEPTION 'FAIL: reversao por fora do pedido';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.ship_order(o,gen_random_uuid(),2,'Enviado manualmente','TRACK-TESTE');
 IF r ->> 'status'<>'SHIPPED' THEN RAISE EXCEPTION 'FAIL: envio';END IF;
 BEGIN PERFORM public.cancel_order(o,gen_random_uuid(),3,'Cancelar ja enviado');
  RAISE EXCEPTION 'FAIL: cancelar enviado';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.deliver_order(o,gen_random_uuid(),3,'Entrega confirmada');
 IF r ->> 'status'<>'DELIVERED' THEN RAISE EXCEPTION 'FAIL: entrega';END IF;
 RAISE NOTICE 'PASS: termos, pagamento integral, baixa/reserva, replay, envio e entrega';
END $$;

DO $$ DECLARE o uuid;p uuid;r jsonb;items jsonb;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_1';SELECT value INTO p FROM order_ops_context WHERE key='product';
 SELECT jsonb_agg(jsonb_build_object('order_item_id',id,'disposition','RESTOCKED')) INTO items FROM public.order_items WHERE order_id=o;
 BEGIN PERFORM public.return_order(o,gen_random_uuid(),4,items,false,true,'PIX','Devolucao ainda nao recebida');
  RAISE EXCEPTION 'FAIL: devolucao sem recebimento';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.return_order(o,gen_random_uuid(),4,items,true,false,'PIX','Sem reembolso confirmado');
  RAISE EXCEPTION 'FAIL: devolucao sem refund';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.return_order(o,'ca000000-0000-4000-8000-000000000003',4,items,true,true,'PIX','Recebida e reembolsada','REFUND-TESTE');
 IF r ->> 'status'<>'RETURNED' THEN RAISE EXCEPTION 'FAIL: status devolvido';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=p AND quantity=20 AND stock_value=200) THEN RAISE EXCEPTION 'FAIL: reposicao ao custo original';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o AND kind='REFUND' AND amount=45) THEN RAISE EXCEPTION 'FAIL: refund inclui frete';END IF;
 r:=public.return_order(o,'ca000000-0000-4000-8000-000000000003',4,items,true,true,'PIX','Recebida e reembolsada','REFUND-TESTE');
 IF NOT(r ->> 'replayed')::boolean THEN RAISE EXCEPTION 'FAIL: replay devolucao';END IF;
 RAISE NOTICE 'PASS: devolucao total, reembolso integral e reposicao exata';
END $$;

DO $$ DECLARE o uuid;p uuid;r jsonb;items jsonb;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_2';SELECT value INTO p FROM order_ops_context WHERE key='product';
 PERFORM public.update_order_terms(o,gen_random_uuid(),0,0,'Frete gratuito confirmado');
 PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'CASH','Dinheiro recebido');
 PERFORM public.ship_order(o,gen_random_uuid(),2,'Pedido enviado');
 SELECT jsonb_agg(jsonb_build_object('order_item_id',id,'disposition','DAMAGED')) INTO items FROM public.order_items WHERE order_id=o;
 r:=public.return_order(o,gen_random_uuid(),3,items,true,true,'CASH','Produtos retornaram danificados');
 IF r ->> 'status'<>'RETURNED' THEN RAISE EXCEPTION 'FAIL: dano';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=p AND quantity=18 AND stock_value=180) THEN RAISE EXCEPTION 'FAIL: dano reentrou em estoque vendavel';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_return_items WHERE order_id=o AND restocked_value=0 AND loss_value=20) THEN RAISE EXCEPTION 'FAIL: perda de valor';END IF;
 RAISE NOTICE 'PASS: produto danificado nao volta ao estoque vendavel e perda fica rastreada';
END $$;

DO $$ DECLARE o uuid;p uuid;r jsonb;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_3';SELECT value INTO p FROM order_ops_context WHERE key='product';
 r:=public.cancel_order(o,gen_random_uuid(),0,'Cliente desistiu antes de pagar');
 IF r ->> 'status'<>'CANCELLED' OR EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o) THEN RAISE EXCEPTION 'FAIL: cancelamento pendente';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE order_id=o AND state='HELD') THEN RAISE EXCEPTION 'FAIL: reserva nao liberada';END IF;
 SELECT value INTO o FROM order_ops_context WHERE key='order_4';
 PERFORM public.update_order_terms(o,gen_random_uuid(),0,0,'Frete gratuito confirmado');
 PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'PIX','Pagamento recebido');
 BEGIN PERFORM public.cancel_order(o,gen_random_uuid(),2,'Cancelar sem refund');
  RAISE EXCEPTION 'FAIL: cancelamento pago sem refund';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.cancel_order(o,gen_random_uuid(),2,'Cancelado e reembolsado antes do envio',true,'PIX','REF-CANCEL');
 IF r ->> 'status'<>'CANCELLED' THEN RAISE EXCEPTION 'FAIL: cancelamento pago';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.inventory_balances WHERE product_id=p AND quantity=18 AND stock_value=180) THEN RAISE EXCEPTION 'FAIL: reposicao no cancelamento';END IF;
 RAISE NOTICE 'PASS: cancelar pendente libera reserva; cancelar pago exige refund e reestoca';
END $$;
RESET ROLE;

-- Reserva vencida e disponibilidade tomada por outro pedido: nao pagar silenciosamente.
UPDATE public.inventory_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE order_id=(SELECT value FROM order_ops_context WHERE key='order_5');
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid;p uuid;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_5';SELECT value INTO p FROM order_ops_context WHERE key='product';
 PERFORM public.update_order_terms(o,gen_random_uuid(),0,0,'Termos apos reserva expirada');
 PERFORM public.register_inventory_movement(p,gen_random_uuid(),'EXIT',18,'Saida de toda disponibilidade');
 BEGIN PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'PIX','Pagamento tardio sem estoque');
  RAISE EXCEPTION 'FAIL: pagou sem disponibilidade';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=o) OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=o AND status='PENDING' AND revision=1) THEN
  RAISE EXCEPTION 'FAIL: pagamento falhou parcialmente';END IF;
 BEGIN PERFORM public.archive_product(p);RAISE EXCEPTION 'FAIL: produto com pedido aberto arquivado';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.register_inventory_movement(p,gen_random_uuid(),'ENTRY',2,'Reposicao para pagamento tardio',12);
 PERFORM public.confirm_order_payment(o,gen_random_uuid(),1,40,'PIX','Pagamento tardio apos reposicao');
 RAISE NOTICE 'PASS: reserva expirada revalida estoque e falha reverte todos os efeitos';
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','bc222222-2222-4222-8222-222222222222',true);
SELECT set_config('request.jwt.claims','{"sub":"bc222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid;n integer;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_5';
 SELECT count(*) INTO n FROM public.order_payments;
 IF n<>0 THEN RAISE EXCEPTION 'FAIL: recibos de outra loja';END IF;
 BEGIN PERFORM public.ship_order(o,gen_random_uuid(),2,'Envio de outra conta');RAISE EXCEPTION 'FAIL: operacao cruzada';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.orders SET status='DELIVERED';RAISE EXCEPTION 'FAIL: UPDATE direto';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: RLS, operacoes privadas e nenhuma escrita direta';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','cc333333-3333-4333-8333-333333333333',true);
SELECT set_config('request.jwt.claims','{"sub":"cc333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE o uuid;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_5';
 UPDATE public.permissions SET is_active=false WHERE code='orders.ship';
 BEGIN PERFORM public.ship_order(o,gen_random_uuid(),2,'Permissao desativada');RAISE EXCEPTION 'FAIL: SUDO ignora flag';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RAISE NOTICE 'PASS: SUDO respeita permissao desativada';
END $$;
RESET ROLE;
UPDATE public.permissions SET is_active=true WHERE code='orders.ship';
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb;o uuid;
BEGIN
 SELECT value INTO o FROM order_ops_context WHERE key='order_1';
 r:=public.get_public_order_status('operacao-a',o,repeat('1',64));
 IF r ->> 'status'<>'RETURNED' OR(r ->> 'shipping_amount')::numeric<>5 OR NOT(r ->> 'shipping_included')::boolean THEN RAISE EXCEPTION 'FAIL: status publico/frete';END IF;
 IF(r -> 'timeline' -> 0) ? 'actor_id' OR(r -> 'timeline' -> 0) ? 'note' OR r ? 'allocated_cost' THEN RAISE EXCEPTION 'FAIL: dados internos expostos';END IF;
 IF NOT(r -> 'payment' ->> 'refunded')::boolean THEN RAISE EXCEPTION 'FAIL: refund publico';END IF;
 RAISE NOTICE 'PASS: acompanhamento continua protegido e sem notas/custos internos';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.orders o WHERE o.store_id=(SELECT value FROM order_ops_context WHERE key='store')
  AND(o.revision<>(SELECT max(revision) FROM public.order_status_history WHERE order_id=o.id))) THEN RAISE EXCEPTION 'FAIL: historico/revisao';END IF;
 IF EXISTS(SELECT 1 FROM public.inventory_balances b WHERE b.store_id=(SELECT value FROM order_ops_context WHERE key='store')
  AND(b.quantity<>(SELECT sum(quantity_delta) FROM public.inventory_movements WHERE product_id=b.product_id)
  OR b.stock_value<>(SELECT sum(value_delta) FROM public.inventory_movements WHERE product_id=b.product_id))) THEN RAISE EXCEPTION 'FAIL: estoque nao concilia';END IF;
 RAISE NOTICE 'PASS: historico, estoque e registros financeiros consistentes';
END $$;
ROLLBACK;
