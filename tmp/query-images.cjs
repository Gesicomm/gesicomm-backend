require('dotenv').config({quiet:true});
const {Client}=require('pg');
const c=new Client({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionTimeoutMillis:8000});
(async()=>{await c.connect(); for(const sql of process.argv.slice(2)) console.log(JSON.stringify((await c.query(sql)).rows)); await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});
