-- Audit log append-only: update aur delete dono mana.
CREATE FUNCTION visit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'visit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER visit_events_no_change
  BEFORE UPDATE OR DELETE ON visit_events
  FOR EACH ROW EXECUTE FUNCTION visit_events_immutable();

-- VIS-2026-00412 jaise visit codes ke liye.
CREATE SEQUENCE visit_code_seq;
