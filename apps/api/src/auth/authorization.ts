import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PermissionKey } from '@restaurant/shared-types';
import { AuthService, type Principal } from './auth.service';
export const Public = () => SetMetadata('public', true);
export const Authenticated = () => SetMetadata('permissions', []);
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata('permissions', permissions);
export interface ApiRequest extends Request {
  principal: Principal;
  requestId: string;
}
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Authentication required');
    request.principal = await this.auth.authenticate(header.slice(7));
    request.principal.requestId = request.requestId;
    request.principal.ip = request.ip;
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>('permissions', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || !required.every((key) => request.principal.permissions.includes(key)))
      throw new ForbiddenException('Permission denied');
    return true;
  }
}
