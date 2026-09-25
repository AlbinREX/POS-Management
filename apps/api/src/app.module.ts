import { DevicesController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { FiscalController } from './fiscal/fiscal.controller';
import { FiscalService } from './fiscal/fiscal.service';
import { OpsController } from './ops/ops.controller';
import { OpsService } from './ops/ops.service';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { SyncWorker } from './sync/sync.worker';
import { ReportingController } from './reporting/reporting.controller';
import { ReportingService } from './reporting/reporting.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { PurchasingController } from './purchasing/purchasing.controller';
import { PurchasingService } from './purchasing/purchasing.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { Module } from '@nestjs/common';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { KitchenController } from './kitchen/kitchen.controller';
import { KitchenService } from './kitchen/kitchen.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseService } from './database.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthorizationGuard } from './auth/authorization';
import { FoundationController } from './foundation/foundation.controller';
import { FoundationService } from './foundation/foundation.service';
import { HealthController } from './health.controller';
import { MenuController } from './menu/menu.controller';
import { MenuService } from './menu/menu.service';
import { LayoutController } from './layout/layout.controller';
import { LayoutService } from './layout/layout.service';
@Module({
  controllers: [
    DevicesController,
    FiscalController,
    OpsController,
    SyncController,
    ReportingController,
    CompaniesController,
    PurchasingController,
    InventoryController,
    PaymentsController,
    KitchenController,
    OrdersController,
    AuthController,
    FoundationController,
    HealthController,
    MenuController,
    LayoutController,
  ],
  providers: [
    DevicesService,
    FiscalService,
    OpsService,
    SyncService,
    SyncWorker,
    ReportingService,
    CompaniesService,
    PurchasingService,
    InventoryService,
    PaymentsService,
    KitchenService,
    OrdersService,
    DatabaseService,
    AuthService,
    FoundationService,
    MenuService,
    LayoutService,
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class AppModule {}
