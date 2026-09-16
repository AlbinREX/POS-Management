import 'dotenv/config';
import pg from 'pg';
export async function provisionRuntime(
  url = process.env.MIGRATION_DATABASE_URL,
  password = process.env.APP_DATABASE_PASSWORD,
) {
  if (!url || !password || password.length < 24 || /CHANGE_ME/.test(password))
    throw new Error('Runtime provisioning requires migration URL and a strong runtime password');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(9472832)');
    const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'restaurant_app'");
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    const sql = await client.query(
      `SELECT format('${verb} ROLE restaurant_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text) AS sql`,
      [password],
    );
    await client.query(sql.rows[0].sql);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await client.query('GRANT USAGE ON SCHEMA public TO restaurant_app');
    await client.query(
      'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO restaurant_app',
    );
    await client.query('REVOKE ALL ON "_prisma_migrations" FROM restaurant_app');
    await client.query('REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM restaurant_app');
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "OrderBill", "OrderSettlement", "Payment", "PaymentReversal", "PaymentAllocation", "CashMovement", "PaymentEvent" FROM restaurant_app',
    );
    await client.query('REVOKE UPDATE, DELETE, TRUNCATE ON "LayoutEvent" FROM restaurant_app');
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "KitchenSubmission", "KitchenTicketItem", "KitchenEvent" FROM restaurant_app',
    );
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "OrderEvent", "OrderItemModifier" FROM restaurant_app',
    );
    await client.query(
      'GRANT DELETE ON "RolePermission", "UserBranchRole", "ProductModifierGroup", "ProductKitchenStation" TO restaurant_app',
    );
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "InventoryUnit", "RecipeVersion", "RecipeItem", "InventoryPlan", "InventoryPlanItem", "StockMovement", "InventoryEvent" FROM restaurant_app',
    );
    await client.query('REVOKE INSERT ON "InventoryUnit" FROM restaurant_app');
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "GoodsReceipt", "GoodsReceiptItem", "SupplierEntry", "PurchasingEvent" FROM restaurant_app',
    );
    await client.query(
      'REVOKE UPDATE, DELETE, TRUNCATE ON "CompanyLedgerEntry", "CompanyStatement", "CompanyStatementLine", "CompaniesEvent" FROM restaurant_app',
    );
    // Phase 12: the delivery checkpoint is operational metadata, not business history.
    // The runtime role advances it (INSERT/UPDATE) but may never delete or truncate it,
    // and it holds no business data that could overwrite a local record.
    await client.query('REVOKE DELETE, TRUNCATE ON "SyncCheckpoint" FROM restaurant_app');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith('provision-runtime.mjs'))
  provisionRuntime().catch(() => {
    console.error(
      'Runtime provisioning failed. Verify migration credentials and runtime password.',
    );
    process.exitCode = 1;
  });
