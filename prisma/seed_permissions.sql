-- Asegurar módulo 'orders'
INSERT INTO public.modules (id, key, name, description, is_active, created_at, updated_at)
SELECT uuid_generate_v4(), 'orders', 'Orders', 'Gestión de órdenes', TRUE, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.modules m WHERE m.key = 'orders');

-- Asegurar permiso 'orders_delivery' para módulo 'orders'
INSERT INTO public.permissions (id, module_id, action, description, created_at, updated_at)
SELECT uuid_generate_v4(), m.id, 'orders_delivery', 'Permite a delivery actualizar estados de órdenes', now(), now()
FROM public.modules m
WHERE m.key = 'orders'
AND NOT EXISTS (
  SELECT 1 FROM public.permissions p WHERE p.module_id = m.id AND p.action = 'orders_delivery'
);

-- Asegurar rol 'delivery'
INSERT INTO public.roles (id, name, description, created_at, updated_at)
SELECT uuid_generate_v4(), 'delivery', 'Personal de reparto', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = 'delivery');

-- Vincular permiso al rol 'delivery'
INSERT INTO public.role_permissions (id, role_id, permission_id, granted_at)
SELECT uuid_generate_v4(), r.id, p.id, now()
FROM public.roles r
JOIN public.permissions p ON p.action = 'orders_delivery'
WHERE r.name = 'delivery'
AND NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);


-- Asegurar módulo 'plant'
INSERT INTO public.modules (id, key, name, description, is_active, created_at, updated_at)
SELECT uuid_generate_v4(), 'plant', 'Planta', 'Operaciones de planta (recepción y proceso)', TRUE, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.modules m WHERE m.key = 'plant');

-- Asegurar permisos para módulo 'plant'
-- Permite operar estados en planta (at_plant -> processing -> ready_for_delivery)
INSERT INTO public.permissions (id, module_id, action, description, created_at, updated_at)
SELECT uuid_generate_v4(), m.id, 'plant_process', 'Operar órdenes en planta', now(), now()
FROM public.modules m
WHERE m.key = 'plant'
AND NOT EXISTS (
  SELECT 1 FROM public.permissions p WHERE p.module_id = m.id AND p.action = 'plant_process'
);

-- Permite gestión avanzada (re-asignaciones, correcciones)
INSERT INTO public.permissions (id, module_id, action, description, created_at, updated_at)
SELECT uuid_generate_v4(), m.id, 'plant_manage', 'Administrar operaciones y reasignaciones en planta', now(), now()
FROM public.modules m
WHERE m.key = 'plant'
AND NOT EXISTS (
  SELECT 1 FROM public.permissions p WHERE p.module_id = m.id AND p.action = 'plant_manage'
);

-- Asegurar rol 'planta'
INSERT INTO public.roles (id, name, description, created_at, updated_at)
SELECT uuid_generate_v4(), 'planta', 'Operador de planta', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = 'planta');

-- Vincular permisos de planta al rol 'planta'
INSERT INTO public.role_permissions (id, role_id, permission_id, granted_at)
SELECT uuid_generate_v4(), r.id, p.id, now()
FROM public.roles r
JOIN public.modules m ON m.key = 'plant'
JOIN public.permissions p ON p.module_id = m.id AND p.action IN ('plant_process','plant_manage')
WHERE r.name = 'planta'
AND NOT EXISTS (
  SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
);

