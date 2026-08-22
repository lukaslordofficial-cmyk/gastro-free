import fs from 'fs';

let src = fs.readFileSync('server.py', 'utf8');
const start = src.indexOf('@app.get("/api/admin/migration-status")');
if (start < 0) {
  console.error('migration-status not found');
  process.exit(1);
}
let cut = src.lastIndexOf('# ─', start);
if (cut < 0) cut = src.lastIndexOf('\n\n', start);
const endMarker = '# Daily reports: backend/daily_report_routes.py';
const end = src.indexOf(endMarker, start);
if (end < 0) {
  console.error('end marker not found');
  process.exit(1);
}
src =
  src.slice(0, cut) +
  '\n# Admin migration-status: backend/admin_routes.py (include_router)\n\n' +
  src.slice(end);

if (!src.includes('from admin_routes import')) {
  src = src.replace(
    'from supplier_catalog_view_routes import router as supplier_catalog_view_router\n',
    'from supplier_catalog_view_routes import router as supplier_catalog_view_router\nfrom admin_routes import router as admin_router\n',
  );
  src = src.replace(
    'from supplier_catalog_view_routes import router as supplier_catalog_view_router\r\n',
    'from supplier_catalog_view_routes import router as supplier_catalog_view_router\r\nfrom admin_routes import router as admin_router\r\n',
  );
}
if (!src.includes('app.include_router(admin_router)')) {
  src = src.replace(
    'app.include_router(supplier_catalog_view_router)\n',
    'app.include_router(supplier_catalog_view_router)\napp.include_router(admin_router)\n',
  );
  src = src.replace(
    'app.include_router(supplier_catalog_view_router)\r\n',
    'app.include_router(supplier_catalog_view_router)\r\napp.include_router(admin_router)\r\n',
  );
}

fs.writeFileSync('server.py', src);
console.log({
  import: src.includes('admin_router'),
  gone: !src.includes('def admin_migration_status'),
  lines: src.split(/\r?\n/).length,
});
