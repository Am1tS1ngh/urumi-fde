import { Module, type DynamicModule } from '@nestjs/common';
import { WooCommerceClient } from './woocommerce.js';
import { HealthController } from './health.controller.js';
import { McpService } from './mcp/mcp.service.js';

@Module({})
export class WooCommerceModule {
  static register(store: WooCommerceClient, token: string, allowedHosts: string[] = []): DynamicModule {
    return {
      module: WooCommerceModule,
      controllers: [HealthController],
      providers: [
        { provide: WooCommerceClient, useValue: store },
        // Explicit injection also works in tsx, which does not emit metadata.
        { provide: McpService, inject: [WooCommerceClient], useFactory: (client: WooCommerceClient) => new McpService(client, token, allowedHosts) },
      ],
    };
  }
}
