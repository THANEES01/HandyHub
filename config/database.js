import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'HandyHub',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '#As011416#'
});

export default pool;