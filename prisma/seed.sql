BEGIN;

INSERT INTO roles (name, description)
VALUES
  ('admin', 'Administrador del sistema con acceso completo'),
  ('institution_employee', 'Empleado de institución cliente'),
  ('operator', 'Operador de lavandería'),
  ('delivery', 'Personal de reparto'),
  ('manager', 'Gerente de operaciones'),
  ('accountant', 'Personal contable')
ON CONFLICT (name) DO NOTHING;

WITH admin_role AS (SELECT id FROM roles WHERE name = 'admin')
INSERT INTO users (email, password_hash, role_id, is_active, last_login_at)
SELECT 'admin@misslaundry.com', crypt('admin123', gen_salt('bf')), admin_role.id, TRUE, now()
FROM admin_role
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@misslaundry.com');

WITH admin_user AS (SELECT id FROM users WHERE email = 'admin@misslaundry.com')
INSERT INTO profiles (user_id, full_name, phone, cedula, monthly_credit_limit, available_credit)
SELECT id, 'Administrador Principal', '809-000-0000', '00123456789', 0.00, 0.00
FROM admin_user
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = (SELECT id FROM admin_user));

COMMIT;
