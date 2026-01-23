CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id VARCHAR(36) PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, finished_at, applied_steps_count)
VALUES 
('1', 'baseline1', '20251226225736_init', now(), 1),
('2', 'baseline2', '20251229233207_add_break_tracking', now(), 1),
('3', 'baseline3', '20251230235223_add_shift_scheduling', now(), 1)
ON CONFLICT DO NOTHING;
