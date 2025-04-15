/*
  # Add merchandise value and status update date

  1. Changes
    - Add `valor_mercadoria` column to store merchandise value
    - Add `status_updated_at` column to track when status was last updated
*/

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS valor_mercadoria numeric(10,2),
ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;