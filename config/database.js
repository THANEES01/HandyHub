import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    host: process.env.DB_HOST || 'ep-restless-feather-a5t96quy-pooler.us-east-2.aws.neon.tech',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'HandyHub',
    user: process.env.DB_USER || 'HandyHub_owner',
    password: process.env.DB_PASSWORD || "npg_S5JrMvV1WYos",
    ssl: {
        rejectUnauthorized: true // This enforces SSL certificate validation
      }
});

export default pool;