import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from './llm.interface';
import { createLoadBalancedProvider } from './llm-provider.factory';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const llmConfig = config.get('llm');
        return createLoadBalancedProvider(llmConfig);
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LLMModule {}
