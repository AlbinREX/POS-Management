import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createDatabase } from '@restaurant/database';
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client = createDatabase();
  async onModuleInit() {
    await this.client.$connect();
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
