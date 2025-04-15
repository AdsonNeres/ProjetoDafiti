/*
  # Create orders tracking table

  1. New Tables
    - `orders`
      - `id` (uuid, primary key)
      - `referencia` (text, not null)
      - `ultima_ocorrencia` (text, not null)
      - `data_ultima_ocorrencia` (timestamptz, not null)
      - `status` (text, not null)
      - `created_at` (timestamptz, default now())
  
  2. Security
    - Enable RLS on `orders` table
    - Add policy for authenticated users to read/write their own data
*/

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referencia text NOT NULL,
  ultima_ocorrencia text NOT NULL,
  data_ultima_ocorrencia timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Pendentes',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON orders
  FOR SELECT TO public USING (true);

CREATE POLICY "Enable insert access for all users" ON orders
  FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Enable update access for all users" ON orders
  FOR UPDATE TO public USING (true);