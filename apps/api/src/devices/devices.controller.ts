import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  deviceInputSchema,
  deviceListSchema,
  deviceTestSchema,
  deviceUpdateSchema,
  managerOverrideSchema,
  managerPinSchema,
  nfcEnrollSchema,
  printJobListSchema,
  printResultSchema,
  printRetrySchema,
  stationPrinterSchema,
} from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { DevicesService } from './devices.service';

/**
 * Device configuration, printer routing, print delivery and staff cards.
 *
 * Branch and organization always come from the session. No route accepts a COM port, a
 * host or a TCP port except the configuration routes, which require device.manage: a
 * print or a test names a saved device by id and the server supplies its address.
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly service: DevicesService) {}

  @Get() @RequirePermissions('device.read') list(@Req() r: ApiRequest, @Query() q: unknown) {
    deviceListSchema.parse(q);
    return this.service.list(r.principal);
  }

  @Get('overview') @RequirePermissions('device.read') overview(@Req() r: ApiRequest) {
    return this.service.overview(r.principal);
  }

  @Get('stations') @RequirePermissions('device.read') stations(@Req() r: ApiRequest) {
    return this.service.stations(r.principal);
  }

  @Get('jobs') @RequirePermissions('device.read') jobs(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.jobs(r.principal, printJobListSchema.parse(q).state);
  }

  @Post() @RequirePermissions('device.read', 'device.manage') create(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.save(r.principal, deviceInputSchema.parse(body));
  }

  @Put(':id') @RequirePermissions('device.read', 'device.manage') update(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const parsed = deviceUpdateSchema.parse(body);
    return this.service.save(r.principal, parsed.data, id, parsed.version);
  }

  @Delete(':id') @RequirePermissions('device.read', 'device.manage') archive(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version') version: string,
  ) {
    return this.service.archive(r.principal, id, Number(version));
  }

  /**
   * The saved address of one device, for the Device Agent.
   *
   * Behind device.read like every other configuration view. It exists so the agent never
   * has to accept an address from the browser.
   */
  @Get(':id/target') @RequirePermissions('device.read') target(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.target(r.principal, id);
  }

  /** Record the outcome of a Test press. The agent performs the probe. */
  @Post(':id/test') @RequirePermissions('device.read', 'device.manage') test(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.recordTest(r.principal, id, deviceTestSchema.parse(body));
  }

  @Post('stations') @RequirePermissions('device.read', 'device.manage') bind(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.bindStation(r.principal, stationPrinterSchema.parse(body));
  }

  /** Queue the kitchen tickets of an order. Safe to call again: nothing duplicates. */
  @Post('orders/:id/tickets') @RequirePermissions('device.read', 'kitchen.read') queueTickets(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.queueOrderTickets(r.principal, id);
  }

  /** Queue the customer receipt for a settled order. */
  @Post('orders/:id/receipt') @RequirePermissions('device.read', 'payment.read') queueReceipt(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.queueReceipt(r.principal, id);
  }

  /** The Device Agent reports what happened for one job. */
  @Post('jobs/result') @RequirePermissions('device.read') result(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.recordResult(r.principal, printResultSchema.parse(body));
  }

  @Post('jobs/:id/retry') @RequirePermissions('device.read', 'device.manage') retry(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    printRetrySchema.parse(body);
    return this.service.retry(r.principal, id);
  }

  // --- staff cards -----------------------------------------------------------

  @Get('nfc/:userId') @RequirePermissions('device.read', 'user.read') cards(
    @Req() r: ApiRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.service.cardsFor(r.principal, userId);
  }

  /** Assigning a card is a staff-management action, so it needs user.manage too. */
  @Post('nfc/enroll') @RequirePermissions('device.manage', 'user.manage') enroll(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    const input = nfcEnrollSchema.parse(body);
    return this.service.enrollNfc(r.principal, input);
  }

  @Post('nfc/:id/revoke') @RequirePermissions('device.manage', 'user.manage') revoke(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.revokeNfc(r.principal, id);
  }

  @Post('nfc/manager-pin') @RequirePermissions('device.manage', 'user.manage') managerPin(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    const input = managerPinSchema.parse(body);
    return this.service.setManagerPin(r.principal, input);
  }

  /**
   * Authorise a sensitive action with a manager's card and PIN.
   *
   * Available to any authenticated session, because the point is that the person at the
   * till does not hold this authority: the manager taps their own card to grant it. The
   * override is audited and confers nothing beyond the named action.
   */
  @Post('nfc/override') @RequirePermissions('device.read') override(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.managerOverride(r.principal, managerOverrideSchema.parse(body));
  }
}
