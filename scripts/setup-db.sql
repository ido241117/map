SELECT 'CREATE DATABASE hcm_land_mvp'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hcm_land_mvp')\gexec
