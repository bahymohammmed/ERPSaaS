import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditService } from './common/audit.service';
import { AuthGuard } from './common/auth.guard';
import { Public } from './common/decorators';
import { ErrorFilter } from './common/error.filter';
import { TokenService } from './common/token.service';
import { DbService } from './db/db.service';
import { AccountsService } from './gl/accounts.service';
import { AllocationService } from './gl/allocation.service';
import { AnalysisReportsService } from './gl/analysis-reports.service';
import { BudgetsService } from './gl/budgets.service';
import { ConsolidationService } from './gl/consolidation.service';
import { IntercompanyService } from './gl/intercompany.service';
import { ConsolidationController, Phase3CompanyController } from './gl/phase3.controller';
import { FxRevaluationService } from './gl/fx-revaluation.service';
import { ImportService } from './gl/import.service';
import { Phase2Controller } from './gl/phase2.controller';
import { RecurringScheduler, RecurringService } from './gl/recurring.service';
import { YearEndService } from './gl/year-end.service';
import { AttachmentsService } from './gl/attachments.service';
import { CostCentersService } from './gl/cost-centers.service';
import { ExportService } from './gl/export/export.service';
import { FiscalService } from './gl/fiscal.service';
import { JournalsController } from './gl/journals.controller';
import { JournalsService } from './gl/journals.service';
import { MasterDataController } from './gl/master-data.controller';
import { MastersService } from './gl/masters.service';
import { PostingEngine } from './gl/posting.engine';
import { ReportsController } from './gl/reports.controller';
import { ReportsService } from './gl/reports.service';
import { AdminController } from './platform/admin.controller';
import { AdminService } from './platform/admin.service';
import { AuthController } from './platform/auth.controller';
import { AuthService } from './platform/auth.service';
import { ProvisioningService } from './platform/provisioning.service';

@Controller('health')
class HealthController {
  constructor(private readonly db: DbService) {}

  @Public()
  @Get()
  async health() {
    await this.db.pool.query('SELECT 1');
    return { status: 'ok' };
  }
}

@Module({
  controllers: [HealthController, AuthController, AdminController, MasterDataController, JournalsController, ReportsController, Phase2Controller, Phase3CompanyController, ConsolidationController],
  providers: [
    DbService,
    TokenService,
    AuditService,
    ProvisioningService,
    AuthService,
    AdminService,
    FiscalService,
    AccountsService,
    CostCentersService,
    MastersService,
    PostingEngine,
    JournalsService,
    AttachmentsService,
    ReportsService,
    ExportService,
    RecurringService,
    RecurringScheduler,
    FxRevaluationService,
    AllocationService,
    BudgetsService,
    YearEndService,
    AnalysisReportsService,
    ImportService,
    IntercompanyService,
    ConsolidationService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule {}
