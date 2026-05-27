import type { SettingsHost } from "./SettingsPage";
import { SettingsPage } from "./SettingsPage";
import { GeneralPage } from "./GeneralPage";
import { VaultPage } from "./VaultPage";
import { ContractsPage } from "./ContractsPage";
import { EdgesPage } from "./EdgesPage";
import { CompatibilityPage } from "./CompatibilityPage";
import { SemiringsPage } from "./SemiringsPage";
import { SearchPage } from "./SearchPage";
import { SauceBotPage } from "./SauceBotPage";
import { LocalLLMPage } from "./LocalLLMPage";
import { SkillsPage } from "./SkillsPage";
import { IntegrationsRoot } from "./IntegrationsRoot";
import { GeocodingPage } from "./GeocodingPage";
import { SyncPage } from "./SyncPage";
import { BackendPage } from "./BackendPage";
import { SecurityPage } from "./SecurityPage";
import { ImportExportPage } from "./ImportExportPage";
import { CdelPage } from "./CdelPage";
import { InferencePage } from "./InferencePage";
import { AdvancedPage } from "./AdvancedPage";
import { AboutPage } from "./AboutPage";
import { GoogleWorkspacePage } from "./integrations/GoogleWorkspacePage";
import { Microsoft365Page } from "./integrations/Microsoft365Page";
import { ApplePage } from "./integrations/ApplePage";
import { NotionPage } from "./integrations/NotionPage";
import { TwilioPage } from "./integrations/TwilioPage";
import { SmtpImapPage } from "./integrations/SmtpImapPage";
import { WebSearchPage } from "./integrations/WebSearchPage";

export interface PageNode {
  page: SettingsPage;
  children?: PageNode[];
}

export function buildSettingsTree(host: SettingsHost): PageNode[] {
  return [
    { page: new GeneralPage(host) },
    { page: new VaultPage(host) },
    { page: new ContractsPage(host) },
    { page: new EdgesPage(host) },
    { page: new CompatibilityPage(host) },
    { page: new SemiringsPage(host) },
    { page: new SearchPage(host) },
    { page: new SauceBotPage(host) },
    { page: new LocalLLMPage(host) },
    { page: new SkillsPage(host) },
    {
      page: new IntegrationsRoot(host),
      children: [
        { page: new GoogleWorkspacePage(host) },
        { page: new Microsoft365Page(host) },
        { page: new ApplePage(host) },
        { page: new NotionPage(host) },
        { page: new TwilioPage(host) },
        { page: new SmtpImapPage(host) },
        { page: new WebSearchPage(host) },
      ],
    },
    { page: new GeocodingPage(host) },
    { page: new SyncPage(host) },
    { page: new BackendPage(host) },
    { page: new SecurityPage(host) },
    { page: new ImportExportPage(host) },
    { page: new CdelPage(host) },
    { page: new InferencePage(host) },
    { page: new AdvancedPage(host) },
    { page: new AboutPage(host) },
  ];
}
