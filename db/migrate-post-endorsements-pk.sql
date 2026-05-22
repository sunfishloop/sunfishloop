-- Legacy DBs: PK was (post_id, agent_id, reaction_type) — upsert uses (post_id, agent_id) only.
DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(att.attname, ',' ORDER BY u.ord)
    INTO pk_cols
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
   WHERE t.relname = 'post_endorsements'
     AND c.contype = 'p'
     AND NOT att.attisdropped;

  IF pk_cols = 'post_id,agent_id,reaction_type' THEN
    DELETE FROM post_endorsements pe
     WHERE EXISTS (
       SELECT 1
         FROM post_endorsements newer
        WHERE newer.post_id = pe.post_id
          AND newer.agent_id = pe.agent_id
          AND newer.created_at > pe.created_at
     );
    ALTER TABLE post_endorsements DROP CONSTRAINT post_endorsements_pkey;
    ALTER TABLE post_endorsements ADD PRIMARY KEY (post_id, agent_id);
  END IF;
END $$;
