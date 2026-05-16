CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
BEGIN
  RETURN LPAD(FLOOR(random() * 1000000)::INT::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_client_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
BEGIN
  LOOP
    new_code := LPAD(FLOOR(random() * 1000000)::INT::TEXT, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE client_code = new_code);
  END LOOP;
  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_bag_number()
RETURNS TEXT AS $$
DECLARE
  new_number TEXT;
BEGIN
  LOOP
    new_number := 'BAG-' || LPAD(FLOOR(random() * 100000)::INT::TEXT, 5, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM client_bags WHERE bag_number = new_number);
  END LOOP;
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;
