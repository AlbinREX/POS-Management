import { Body, Controller, Get, Post, Put, Param, Query, Req, ParseUUIDPipe } from '@nestjs/common';
import {
  companySchema,
  companyUpdateSchema,
  companyVersionSchema,
  contractSchema,
  contractUpdateSchema,
  contractStatusSchema,
  companyEmployeeSchema,
  companyEmployeeUpdateSchema,
  companyPaymentSchema,
  companyReverseSchema,
  statementSchema,
  companyListSchema,
  layoutChangesSchema,
} from '@restaurant/validation';
import { RequirePermissions, type ApiRequest } from '../auth/authorization';
import { CompaniesService } from './companies.service';
@Controller('companies')
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}
  @Get() @RequirePermissions('company.read') route0(@Req() r: ApiRequest, @Query() q: unknown) {
    return this.service.companies(r.principal, companyListSchema.parse(q));
  }
  @Post() @RequirePermissions('company.read', 'company.manage') route1(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveCompany(r.principal, companySchema.parse(body));
  }
  @Put(':id') @RequirePermissions('company.read', 'company.manage') route2(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveCompany(r.principal, companyUpdateSchema.parse(body), id);
  }
  @Post(':id/archive') @RequirePermissions('company.read', 'company.manage') route3(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.archiveCompany(r.principal, id, companyVersionSchema.parse(body));
  }
  @Get(':id/account') @RequirePermissions('company.read') route4(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.service.account(r.principal, id, companyListSchema.parse(q));
  }
  @Get('directory/contracts') @RequirePermissions('company.read') route5(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.contracts(r.principal, companyListSchema.parse(q));
  }
  @Post('directory/contracts') @RequirePermissions('company.read', 'contract.manage') route6(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveContract(r.principal, contractSchema.parse(body));
  }
  @Put('directory/contracts/:id') @RequirePermissions('company.read', 'contract.manage') route7(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveContract(r.principal, contractUpdateSchema.parse(body), id);
  }
  @Post('directory/contracts/:id/status')
  @RequirePermissions('company.read', 'contract.manage')
  route8(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.contractStatus(r.principal, id, contractStatusSchema.parse(body));
  }
  @Get('directory/employees') @RequirePermissions('company.read') route9(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.employees(r.principal, companyListSchema.parse(q));
  }
  @Post('directory/employees') @RequirePermissions('company.read', 'company.manage') route10(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.saveEmployee(r.principal, companyEmployeeSchema.parse(body));
  }
  @Put('directory/employees/:id') @RequirePermissions('company.read', 'company.manage') route11(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.service.saveEmployee(r.principal, companyEmployeeUpdateSchema.parse(body), id);
  }
  @Post('directory/employees/:id/archive')
  @RequirePermissions('company.read', 'company.manage')
  route12(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.archiveEmployee(r.principal, id, companyVersionSchema.parse(body));
  }
  @Post('directory/payments') @RequirePermissions('company.read', 'company.payment.record') route13(
    @Req() r: ApiRequest,
    @Body() body: unknown,
  ) {
    return this.service.recordPayment(r.principal, companyPaymentSchema.parse(body));
  }
  @Post('directory/payments/:id/reverse')
  @RequirePermissions('company.read', 'company.payment.reverse')
  route14(@Req() r: ApiRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.service.reversePayment(r.principal, id, companyReverseSchema.parse(body));
  }
  @Get('directory/statements') @RequirePermissions('company.read') route15(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.statements(r.principal, companyListSchema.parse(q));
  }
  @Get('directory/statements/:id') @RequirePermissions('company.read') route16(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getStatement(r.principal, id);
  }
  @Post('directory/statements')
  @RequirePermissions('company.read', 'company.statement.manage')
  route17(@Req() r: ApiRequest, @Body() body: unknown) {
    return this.service.generateStatement(r.principal, statementSchema.parse(body));
  }
  @Get('directory/chargeable') @RequirePermissions('company.read', 'company.charge') chargeable(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    return this.service.chargeable(r.principal, companyListSchema.parse(q));
  }
  @Get('directory/events') @RequirePermissions('company.read') events(
    @Req() r: ApiRequest,
    @Query() q: unknown,
  ) {
    const x = layoutChangesSchema.parse(q);
    return this.service.events(r.principal, x.after, x.limit);
  }
  @Get(':id/history') @RequirePermissions('company.read') history(
    @Req() r: ApiRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    const x = layoutChangesSchema.parse(q);
    return this.service.history(r.principal, id, x.after, x.limit);
  }
}
