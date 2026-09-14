import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import {
  inventoryArchiveSchema,
  inventoryItemSchema,
  inventoryItemUpdateSchema,
  inventoryListSchema,
  recipeSchema,
  stockMovementSchema,
  stockThresholdSchema,
  warehouseSchema,
  warehouseUpdateSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@RequirePermissions('inventory.read')
export class InventoryController {
  constructor(private readonly service: InventoryService) {}
  @Get('units') units() {
    return this.service.units();
  }
  @Get('products') products(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.products(r.principal, inventoryListSchema.parse(q));
  }
  @Get('items') items(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.items(r.principal, inventoryListSchema.parse(q));
  }
  @Post('items') @RequirePermissions('inventory.read', 'inventory.manage') createItem(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.createItem(r.principal, inventoryItemSchema.parse(body));
  }
  @Put('items/:id') @RequirePermissions('inventory.read', 'inventory.manage') updateItem(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateItem(r.principal, id, inventoryItemUpdateSchema.parse(body));
  }
  @Post('items/:id/archive') @RequirePermissions('inventory.read', 'inventory.manage') archiveItem(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateItem(r.principal, id, inventoryArchiveSchema.parse(body), true);
  }
  @Get('warehouses') warehouses(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.warehouses(r.principal, inventoryListSchema.parse(q));
  }
  @Post('warehouses') @RequirePermissions('inventory.read', 'inventory.manage') createWarehouse(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.createWarehouse(r.principal, warehouseSchema.parse(body));
  }
  @Put('warehouses/:id') @RequirePermissions('inventory.read', 'inventory.manage') updateWarehouse(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateWarehouse(r.principal, id, warehouseUpdateSchema.parse(body));
  }
  @Post('warehouses/:id/archive')
  @RequirePermissions('inventory.read', 'inventory.manage')
  archiveWarehouse(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateWarehouse(r.principal, id, inventoryArchiveSchema.parse(body), true);
  }
  @Get('recipes') recipes(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.recipes(r.principal, inventoryListSchema.parse(q));
  }
  @Get('recipes/:id/history') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.recipeHistory(r.principal, id, inventoryListSchema.parse(q));
  }
  @Post('recipes') @RequirePermissions('inventory.read', 'recipe.manage') recipe(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveRecipe(r.principal, recipeSchema.parse(body));
  }
  @Get('stock') stock(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.stock(r.principal, inventoryListSchema.parse(q));
  }
  @Get('movements') movements(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.history(r.principal, inventoryListSchema.parse(q));
  }
  @Post('movements') movement(@Req() r: ApiRequest, @Body() body: unknown) {
    const input = stockMovementSchema.parse(body);
    if (
      !r.principal.permissions.includes(
        input.kind === 'WASTE' ? 'inventory.waste' : 'inventory.adjust',
      )
    )
      throw new ForbiddenException('Required inventory movement permission is missing');
    return this.service.movement(r.principal, input);
  }
  @Post('thresholds') @RequirePermissions('inventory.read', 'inventory.manage') threshold(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.threshold(r.principal, stockThresholdSchema.parse(body));
  }
  @Get('events') events(@Req() r: ApiRequest, @Query() q: unknown) {
    const input = layoutChangesSchema.parse(q);
    return this.service.events(r.principal, input.after, input.limit);
  }
}
