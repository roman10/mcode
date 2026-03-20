-- Add parent hashes and refs for commit graph visualization
ALTER TABLE commits ADD COLUMN parent_hashes TEXT;
ALTER TABLE commits ADD COLUMN refs TEXT;
