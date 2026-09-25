import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { changePasswordSchema, loginSchema, nfcLoginSchema } from '@restaurant/validation';
import { COOKIE_NAME, getConfig } from '../config';
import { AuthService } from './auth.service';
import { Authenticated, type ApiRequest, Public } from './authorization';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: new URL(getConfig().APP_ORIGIN).protocol === 'https:',
      sameSite: 'strict' as const,
      path: '/api/auth',
    };
  }
  private sendSession(response: Response, result: Awaited<ReturnType<AuthService['login']>>) {
    const { refreshToken, expiresAt, ...body } = result;
    response.cookie(COOKIE_NAME, refreshToken, { ...this.cookieOptions(), expires: expiresAt });
    return body;
  }
  /**
   * Sign in by tapping a staff card.
   *
   * Public like password login, and rate limited by the same middleware. The body names
   * a card and a branch; the server resolves who that is and what they may do.
   */
  @Public()
  @Post('nfc')
  @HttpCode(200)
  async nfcLogin(
    @Body() body: unknown,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sendSession(
      res,
      await this.auth.nfcLogin(nfcLoginSchema.parse(body), {
        requestId: req.requestId,
        ip: req.ip,
      }),
    );
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.sendSession(
      res,
      await this.auth.login(loginSchema.parse(body), { requestId: req.requestId, ip: req.ip }),
    );
  }
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    try {
      return this.sendSession(
        res,
        await this.auth.refresh(req.cookies?.[COOKIE_NAME] as string | undefined, {
          requestId: req.requestId,
          ip: req.ip,
        }),
      );
    } catch (error) {
      res.clearCookie(COOKIE_NAME, this.cookieOptions());
      throw error;
    }
  }
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE_NAME] as string | undefined, {
      requestId: req.requestId,
      ip: req.ip,
    });
    res.clearCookie(COOKIE_NAME, this.cookieOptions());
  }
  @Authenticated() @Get('me') me(@Req() req: ApiRequest) {
    return req.principal.user;
  }
  @Authenticated()
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @Body() body: unknown,
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const input = changePasswordSchema.parse(body);
    await this.auth.changePassword(req.principal, input.currentPassword, input.newPassword);
    res.clearCookie(COOKIE_NAME, this.cookieOptions());
  }
}
