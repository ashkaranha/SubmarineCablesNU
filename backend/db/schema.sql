CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS cables (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    owners TEXT,
    region TEXT,
    status TEXT,
    shape_length DOUBLE PRECISION,
    document TEXT NOT NULL,
    embedding vector(768) NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    canonical_cable_name TEXT NOT NULL,
    original_cable_name TEXT,
    date TEXT,
    type TEXT,
    specific_location TEXT,
    cause TEXT,
    suspected_actor TEXT,
    nation_state_suspected TEXT,
    outage_impact TEXT,
    dollar_cost TEXT,
    duration_of_outage TEXT,
    status TEXT,
    source TEXT,
    links TEXT[] NOT NULL DEFAULT '{}',
    document TEXT NOT NULL,
    embedding vector(768) NOT NULL
);

CREATE INDEX IF NOT EXISTS cables_embedding_idx
    ON cables USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS incidents_embedding_idx
    ON incidents USING hnsw (embedding vector_cosine_ops);
