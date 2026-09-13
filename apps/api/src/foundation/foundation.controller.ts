import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  assignRolesSchema,
  createRoleSchema,
  createUserSchema,
  rolePermissionsSchema,
  terminalSchema,
  updateTerminalSchema,
  updateUserSchema,
} from '@restaurant/validation';
import { PERMISSIONS } from '@restaurant/shared-types';
import { Authenticated, type ApiRequest, RequirePermissions } from '../auth/authorization';
import { FoundationService } from './foundation.service';
@Controller()
export class FoundationController {
  constructor(private readonly service: FoundationService) {}
  @Get('organization') @RequirePermissions('organization.read') organization(@Req() r: ApiRequest) {
    return this.service.organization(r.principal);
  }
  @Get('branch') @RequirePermissions('branch.read') branch(@Req() r: ApiRequest) {
    return this.service.branch(r.principal);
  }
  @Get('users') @RequirePermissions('user.read') users(@Req() r: ApiRequest) {
    return this.service.users(r.principal);
  }
  @Post('users') @RequirePermissions('user.manage') createUser(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.createUser(r.principal, createUserSchema.parse(body));
  }
  @Patch('users/:id/access') @RequirePermissions('user.manage') setActive(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.setUserActive(r.principal, id, updateUserSchema.parse(body).active);
  }
  @Patch('users/:id/roles') @RequirePermissions('user.manage', 'role.read') assignRoles(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.assignRoles(r.principal, id, assignRolesSchema.parse(body).roleIds);
  }
  @Get('roles') @RequirePermissions('role.read') roles(@Req() r: ApiRequest) {
    return this.service.roles(r.principal);
  }
  @Get('permissions') @RequirePermissions('role.read') permissions() {
    return PERMISSIONS;
  }
  @Post('roles') @RequirePermissions('role.manage') createRole(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    const input = createRoleSchema.parse(body);
    return this.service.createRole(r.principal, input.name, input.permissions);
  }
  @Patch('roles/:id/permissions') @RequirePermissions('role.manage') changeRole(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateRole(r.principal, id, rolePermissionsSchema.parse(body).permissions);
  }
  @Get('terminals') @RequirePermissions('terminal.read') terminals(@Req() r: ApiRequest) {
    return this.service.terminals(r.principal);
  }
  @Post('terminals') @RequirePermissions('terminal.manage') createTerminal(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.createTerminal(r.principal, terminalSchema.parse(body));
  }
  @Patch('terminals/:id') @RequirePermissions('terminal.manage') changeTerminal(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.updateTerminal(r.principal, id, updateTerminalSchema.parse(body));
  }
  @Post('terminals/heartbeat') @Authenticated() heartbeat(@Req() r: ApiRequest) {
    return this.service.heartbeat(r.principal);
  }
  @Get('audit-logs') @RequirePermissions('audit.read') audit(@Req() r: ApiRequest) {
    return this.service.auditLogs(r.principal);
  }
}
