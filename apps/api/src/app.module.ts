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
