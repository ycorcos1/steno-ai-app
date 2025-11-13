-- StenoAI Default Template Migration
-- Migration: 0005_default_template.sql
-- Adds a default demand letter template available to all users

BEGIN;

-- Insert default template if it doesn't already exist
INSERT INTO templates (id, title, content, is_global, owner_id, created_at, updated_at)
SELECT 
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Default',
  '{client_name}
{client_address}

{date}

{employer_name}
{employer_address}

Re: {subject}

Dear {employer_name}:

I am writing to demand payment of ${amount} and to inform you that I intend to resolve this matter out of court. However, if we cannot reach an agreement, I will file a lawsuit.

Statement of Case (Intended for Court Submission):

I was employed by {employer_name} from {employment_start} until my termination on {employment_end}. I am owed ${amount} for my last paycheck period from {wage_period_start} to {wage_period_end}. This amount represents my {pay_period_type} salary.

According to California Labor Code, I should have received my wages in full on the day of my termination. Additionally, Labor Code §203 grants me the right to recover one day of wages for each day my final paycheck remains unpaid.

I am willing to resolve this matter amicably and am open to discussing mediation. Please contact me at {email} to discuss this matter further.

Please send my paycheck, payable to {client_name}, to the address listed at the top of this letter.

If I do not receive a response by {deadline_date}, I will file a lawsuit. In that lawsuit, I will seek additional damages, legal services costs, court costs, and accrued interest.

Sincerely,

{client_name}',
  true,
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM templates WHERE id = '00000000-0000-0000-0000-000000000001'::uuid
);

COMMIT;

