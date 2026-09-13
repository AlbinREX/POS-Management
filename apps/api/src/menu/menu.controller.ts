import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  menuArchiveSchema,
  menuInputSchema,
  menuKindSchema,
  menuListSchema,
  menuUpdateSchema,
} from '@restaurant/validation';
import { type ApiRequest, RequirePermissions } from '../auth/authorization';
import { MenuService } from './menu.service';

@Controller('menu')
export class MenuController {
  constructor(private readonly service: MenuService) {}
  @Get(':kind') @RequirePermissions('menu.read') list(
    @Req() r: ApiRequest,
    @Param('kind') kind: string,
    @Query() query: unknown,
  ) {
    return this.service.list(r.principal, menuKindSchema.parse(kind), menuListSchema.parse(query));
  }
  @Get(':kind/:id') @RequirePermissions('menu.read') get(
    @Req() r: ApiRequest,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(r.principal, menuKindSchema.parse(kind), id);
  }
  @Post(':kind') @RequirePermissions('menu.read', 'menu.manage') create(
    @Req() r: ApiRequest,
    @Param('kind') kind: string,
    @Body() body: unknown,
  ) {
    const input = menuInputSchema.parse(body);
    if (input.kind !== menuKindSchema.parse(kind))
      throw new BadRequestException('Catalog type does not match route');
    return this.service.save(r.principal, input);
  }
  @Put(':kind/:id') @RequirePermissions('menu.read', 'menu.manage') update(
    @Req() r: ApiRequest,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const input = menuUpdateSchema.parse(body);
    if (input.data.kind !== menuKindSchema.parse(kind))
      throw new BadRequestException('Catalog type does not match route');
    return this.service.save(r.principal, input.data, id, input.version);
  }
  @Post(':kind/:id/archive') @RequirePermissions('menu.read', 'menu.manage') archive(
    @Req() r: ApiRequest,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archive(
      r.principal,
      menuKindSchema.parse(kind),
      id,
      menuArchiveSchema.parse(body).version,
    );
  }
}
