import fs from 'fs';

let src = fs.readFileSync('server.py', 'utf8');
const start = src.indexOf('@app.get("/api/suppliers/{supplier_id}/catalog")');
if (start < 0) {
  console.error('catalog route not found');
  process.exit(1);
}
let cut = src.lastIndexOf('\n\n', start);
if (cut < 0) cut = start;
src = src.slice(0, cut) + '\n\n# Supplier catalog view: backend/supplier_catalog_view_routes.py (include_router)\n';

if (!src.includes('from supplier_catalog_view_routes import')) {
  src = src.replace(
    'from daily_report_routes import router as daily_report_router\n',
    'from daily_report_routes import router as daily_report_router\nfrom supplier_catalog_view_routes import router as supplier_catalog_view_router\n',
  );
  src = src.replace(
    'from daily_report_routes import router as daily_report_router\r\n',
    'from daily_report_routes import router as daily_report_router\r\nfrom supplier_catalog_view_routes import router as supplier_catalog_view_router\r\n',
  );
}
if (!src.includes('app.include_router(supplier_catalog_view_router)')) {
  src = src.replace(
    'app.include_router(daily_report_router)\n',
    'app.include_router(daily_report_router)\napp.include_router(supplier_catalog_view_router)\n',
  );
  src = src.replace(
    'app.include_router(daily_report_router)\r\n',
    'app.include_router(daily_report_router)\r\napp.include_router(supplier_catalog_view_router)\r\n',
  );
}

fs.writeFileSync('server.py', src);
console.log({
  import: src.includes('supplier_catalog_view_router'),
  gone: !src.includes('def get_supplier_catalog'),
  lines: src.split(/\r?\n/).length,
});
