import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { SecurityGuardService } from './security-guard.service';

@Module({
  imports: [LLMModule],
  providers: [SecurityGuardService],
  exports: [SecurityGuardService],
})
export class SecurityModule {}
