/**
 * The single translation catalogue for the whole application.
 *
 * Both languages sit side by side on one line so a missing translation is a type error
 * rather than a runtime surprise, and so a reviewer can check a phrase in context
 * without opening two files. Albanian is written in the Kosovo hospitality register
 * staff actually speak, not a literal rendering of the English.
 *
 * What is deliberately absent: enum values, permission keys, API routes, audit action
 * codes, SKUs, currency codes and money strings. Those are data, not language, and
 * translating them would corrupt what is stored or sent to the server.
 *
 * `{name}` placeholders are substituted by `t(key, params)`.
 */
import { CATALOG_MESSAGES } from './catalog-messages';
import { OPERATIONS_MESSAGES } from './operations-messages';
import { REPORT_MESSAGES } from './report-messages';
import { SALES_MESSAGES } from './sales-messages';
import { UI_MESSAGES } from './ui-messages';
import { PERMISSION_MESSAGES } from './permission-messages';

export type Message = { sq: string; en: string };

export const MESSAGES = {
  ...CATALOG_MESSAGES,
  ...OPERATIONS_MESSAGES,
  ...REPORT_MESSAGES,
  ...SALES_MESSAGES,
  ...UI_MESSAGES,
  ...PERMISSION_MESSAGES,
  // --- Brand and shell ---------------------------------------------------------
  'brand.workspace': { sq: 'HAPËSIRA E RESTORANTIT', en: 'RESTAURANT WORKSPACE' },
  'brand.tagline': { sq: 'Ushqimi i mirë i bashkon njerëzit.', en: 'Good food brings people together.' },
  'shell.signOut': { sq: 'Dilni', en: 'Sign out' },
  'shell.administration': { sq: 'Administrimi', en: 'Administration' },
  'shell.language': { sq: 'Gjuha', en: 'Language' },

  // --- Navigation --------------------------------------------------------------
  'nav.workspace': { sq: 'Kryefaqja', en: 'Home' },
  'nav.dashboard': { sq: 'Paneli', en: 'Dashboard' },
  'nav.pos': { sq: 'Arka', en: 'POS' },
  'nav.inventory': { sq: 'Stoku', en: 'Inventory' },
  'nav.purchasing': { sq: 'Blerjet', en: 'Purchasing' },
  'nav.companies': { sq: 'Kompanitë', en: 'Companies' },
  'nav.menu': { sq: 'Menyja', en: 'Menu' },
  'nav.layout': { sq: 'Tavolinat', en: 'Tables' },
  'nav.orders': { sq: 'Porositë', en: 'Orders' },
  'nav.kitchen': { sq: 'Kuzhina', en: 'Kitchen' },
  'nav.payments': { sq: 'Pagesat', en: 'Payments' },
  'nav.team': { sq: 'Ekipi', en: 'Team' },
  'nav.roles': { sq: 'Rolet', en: 'Roles' },
  'nav.terminals': { sq: 'Terminalet', en: 'Terminals' },
  'nav.audit': { sq: 'Historiku i auditimit', en: 'Audit history' },

  // --- Tab descriptions --------------------------------------------------------
  'tab.workspace.hint': { sq: 'Mirë se u ktheve. Restoranti yt, gati për punë.', en: 'Welcome back. Your restaurant, ready for service.' },
  'tab.pos.hint': { sq: 'Zgjidh një porosi, shfleto menynë dhe përshtate sipas dëshirës.', en: 'Choose an order, explore the menu and make it yours.' },
  'tab.menu.hint': { sq: 'Konfiguro menynë e disponueshme në këtë degë.', en: 'Configure the menu available in this branch.' },
  'tab.layout.hint': { sq: 'Menaxho hapësirat, planin e sallës dhe disponueshmërinë e tavolinave.', en: 'Manage your areas, floor plan and table availability.' },
  'tab.orders.hint': { sq: 'Krijo dhe menaxho porositë në lokal dhe me vete.', en: 'Create and manage dine-in and takeaway orders.' },
  'tab.kitchen.hint': { sq: 'Fletëporositë e stacioneve, ecuria e përgatitjes dhe historiku.', en: 'Station tickets, preparation progress and history.' },
  'tab.payments.hint': { sq: 'Arkëtimet, historiku i pagesave dhe ndërrimet e arkës.', en: 'Collections, payment history and cash register shifts.' },
  'tab.inventory.hint': { sq: 'Përbërësit, recetat dhe historiku i plotë i stokut.', en: 'Ingredients, recipes and a complete stock history.' },
  'tab.purchasing.hint': { sq: 'Furnitorët, porositë e blerjes dhe pranimi i mallit.', en: 'Suppliers, purchase orders and goods receiving.' },
  'tab.companies.hint': { sq: 'Llogaritë e kompanive, kontratat, punëtorët dhe pasqyrat.', en: 'Company accounts, contracts, employees and statements.' },
  'tab.dashboard.hint': { sq: 'Shitjet, porositë, produktet, stafi, arka, stoku, blerjet dhe llogaritë e kompanive.', en: 'Sales, orders, products, staff, cash, stock, purchasing and company accounts.' },
  'tab.team.hint': { sq: 'Menaxho personat që kanë qasje në këtë degë.', en: 'Manage the people who can access this branch.' },
  'tab.roles.hint': { sq: 'Kontrollo çfarë mund të bëjë secili rol.', en: 'Control what each role can do.' },
  'tab.terminals.hint': { sq: 'Regjistro dhe menaxho terminalet e restorantit.', en: 'Register and manage restaurant workstations.' },
  'tab.devices.hint': { sq: 'Printerët dhe lexuesit e kartelave, gjendja e tyre dhe lidhja me stacionet.', en: 'Printers and card readers, their status and station routing.' },
  'tab.audit.hint': { sq: 'Regjistër i përhershëm i ndryshimeve të ndjeshme në këtë degë.', en: 'A permanent record of sensitive changes in this branch.' },

  // --- Shared actions ----------------------------------------------------------
  'action.save': { sq: 'Ruaj', en: 'Save' },
  'action.cancel': { sq: 'Anulo', en: 'Cancel' },
  'action.close': { sq: 'Mbyll', en: 'Close' },
  'action.reset': { sq: 'Rikthe', en: 'Reset' },
  'action.retry': { sq: 'Provo sërish', en: 'Retry' },
  'action.edit': { sq: 'Ndrysho', en: 'Edit' },
  'action.add': { sq: 'Shto', en: 'Add' },
  'action.remove': { sq: 'Hiq', en: 'Remove' },
  'action.archive': { sq: 'Arkivo', en: 'Archive' },
  'action.confirm': { sq: 'Konfirmo', en: 'Confirm' },
  'action.search': { sq: 'Kërko', en: 'Search' },
  'action.refresh': { sq: 'Rifresko', en: 'Refresh' },
  'action.back': { sq: 'Kthehu', en: 'Back' },
  'action.export': { sq: 'Eksporto', en: 'Export' },
  'action.signIn': { sq: 'Hyr', en: 'Sign in' },

  // --- Shared state ------------------------------------------------------------
  'common.active': { sq: 'Aktiv', en: 'Active' },
  'common.inactive': { sq: 'Joaktiv', en: 'Inactive' },
  'common.archived': { sq: 'I arkivuar', en: 'Archived' },
  'common.yes': { sq: 'Po', en: 'Yes' },
  'common.no': { sq: 'Jo', en: 'No' },
  'common.none': { sq: 'asnjë', en: 'none' },
  'common.loading': { sq: 'Duke u ngarkuar…', en: 'Loading…' },
  'common.version': { sq: 'Versioni', en: 'Version' },
  'common.showArchived': { sq: 'Shfaq të arkivuarat', en: 'Show archived' },

  // --- Login and session ---------------------------------------------------------
  'login.headline1': { sq: "Bërë për orët e pikut.", en: "Made for the rush." },
  'login.headline2': { sq: "Gati për punë.", en: "Ready for service." },
  'login.intro': { sq: "Menyja jote, ekipi yt dhe çdo porosi. Një hapësirë e vetme pune për FastFood Riza.", en: "Your menu, your team and every order. One focused workspace for FastFood Riza." },
  'login.network': { sq: "Lidhu përmes rrjetit të restorantit.", en: "Connect using your restaurant network." },
  'login.title': { sq: "Hyr", en: "Sign in" },
  'login.subtitle': { sq: "Përdor llogarinë e dhënë nga administratori yt.", en: "Use the account provided by your administrator." },
  'login.organization': { sq: "Organizata", en: "Organization" },
  'login.branch': { sq: "Kodi i degës", en: "Branch code" },
  'login.email': { sq: "Email", en: "Email" },
  'login.password': { sq: "Fjalëkalimi", en: "Password" },
  'login.pending': { sq: "Duke hyrë…", en: "Signing in…" },
  'login.help': { sq: "Ke nevojë për qasje? Kontakto administratorin e restorantit.", en: "Need access? Contact your restaurant administrator." },
  'session.connecting': { sq: "Duke u lidhur me restorantin tënd…", en: "Connecting to your restaurant…" },
  'session.unreachable': { sq: "Nuk arrihet serveri lokal. Kontrollo lidhjen e restorantit dhe provo sërish.", en: "Cannot reach the local server. Check your restaurant connection and try again." },
  'session.unreachableShort': { sq: "Nuk arrihet serveri lokal. Kontrollo lidhjen e restorantit.", en: "Cannot reach the local server. Check your restaurant connection." },
  'session.unreachableRetry': { sq: "Nuk arrihet serveri lokal. Provo sërish.", en: "Cannot reach the local server. Try again." },
  'session.serverUnavailable': { sq: "Serveri lokal nuk është i disponueshëm. Provo sërish.", en: "The local server is unavailable. Try again." },
  'kitchen.displayTitle': { sq: "Ekrani i kuzhinës", en: "Kitchen display" },
  'kitchen.noAccess': { sq: "Kjo llogari nuk ka qasje në kuzhinë.", en: "Kitchen access is not granted to this account." },
  'waiter.noAccess': { sq: "Kjo llogari nuk ka qasje në shërbimin e tavolinave.", en: "Table service is not granted to this account." },
  'team.title': { sq: "Ekipi", en: "Team" },
  'team.created': { sq: "Anëtari i ekipit u krijua.", en: "Team member created." },
  'team.name': { sq: "Emri i plotë", en: "Full name" },
  'team.email': { sq: "Email", en: "Email" },
  'team.password': { sq: "Fjalëkalimi i përkohshëm", en: "Temporary password" },
  'team.addMember': { sq: "Shto anëtar", en: "Add member" },
  'team.members': { sq: "Anëtarët e ekipit", en: "Team members" },
  'team.roles': { sq: "Rolet", en: "Roles" },
  'team.status': { sq: "Statusi", en: "Status" },
  'roles.title': { sq: "Rolet", en: "Roles" },
  'roles.saved': { sq: "Lejet e rolit u ruajtën.", en: "Role permissions saved." },
  'roles.permissions': { sq: "Lejet", en: "Permissions" },
  'roles.assigned': { sq: "{count} leje të caktuara", en: "{count} assigned permissions" },
  'roles.protected': { sq: "I mbrojtur", en: "Protected" },
  'terminals.title': { sq: "Terminalet", en: "Terminals" },
  'terminals.registered': { sq: "Terminali u regjistrua.", en: "Terminal registered." },
  'terminals.name': { sq: "Emri i terminalit", en: "Terminal name" },
  'terminals.type': { sq: "Lloji", en: "Type" },
  'terminals.register': { sq: "Regjistro terminal", en: "Register terminal" },
  'terminals.lastSeen': { sq: "Parë së fundi", en: "Last seen" },
  'terminals.never': { sq: "Asnjëherë", en: "Never" },
  'audit.title': { sq: "Historiku i auditimit", en: "Audit history" },
  'audit.action': { sq: "Veprimi", en: "Action" },
  'audit.entity': { sq: "Entiteti", en: "Entity" },
  'audit.time': { sq: "Koha", en: "Time" },
  'audit.user': { sq: "Përdoruesi", en: "User" },
  'audit.note': { sq: "100 ngjarjet e fundit. Orët shfaqen sipas zonës kohore të pajisjes tënde.", en: "Latest 100 events. Times are shown in your device timezone." },

  // --- Overview ------------------------------------------------------------------
  'overview.signedInAs': { sq: "I identifikuar si", en: "Signed in as" },
  'overview.access': { sq: "Qasja", en: "Access" },
  'overview.accountOnly': { sq: "Vetëm qasje në llogari", en: "Account access only" },
  'overview.availablePermissions': { sq: "Lejet e disponueshme", en: "Available permissions" },
  'overview.pendingAccess': { sq: "Aplikacioni yt operativ do të jetë i disponueshëm kur ta aktivizojë administratori.", en: "Your operational application will be available when enabled by your administrator." },

  // --- Team, roles, terminals and audit tables -----------------------------------
  'team.fullName': { sq: "Emri i plotë", en: "Full name" },
  'team.emailAddress': { sq: "Adresa e emailit", en: "Email address" },
  'team.initialPassword': { sq: "Fjalëkalimi fillestar", en: "Initial password" },
  'team.role': { sq: "Roli", en: "Role" },
  'team.selectRole': { sq: "Zgjidh rolin", en: "Select role" },
  'team.addTeamMember': { sq: "Shto anëtar ekipi", en: "Add team member" },
  'team.loading': { sq: "Duke ngarkuar ekipin…", en: "Loading team…" },
  'team.colName': { sq: "Emri", en: "Name" },
  'team.colRole': { sq: "Roli", en: "Role" },
  'team.colAccess': { sq: "Qasja", en: "Access" },
  'team.colAction': { sq: "Veprimi", en: "Action" },
  'team.disabled': { sq: "I çaktivizuar", en: "Disabled" },
  'team.disableAccess': { sq: "Çaktivizo qasjen", en: "Disable access" },
  'team.enableAccess': { sq: "Aktivizo qasjen", en: "Enable access" },
  'roles.role': { sq: "Roli", en: "Role" },
  'roles.createNew': { sq: "Krijo një rol të ri", en: "Create a new role" },
  'roles.roleName': { sq: "Emri i rolit", en: "Role name" },
  'roles.permissionsLegend': { sq: "Lejet", en: "Permissions" },
  'terminals.terminalName': { sq: "Emri i terminalit", en: "Terminal name" },
  'terminals.typeLabel': { sq: "Lloji", en: "Type" },
  'terminals.loading': { sq: "Duke ngarkuar terminalet…", en: "Loading terminals…" },
  'terminals.colDevice': { sq: "Pajisja", en: "Device" },
  'terminals.colType': { sq: "Lloji", en: "Type" },
  'terminals.colLastSeen': { sq: "Parë së fundi", en: "Last seen" },
  'terminals.colAccess': { sq: "Qasja", en: "Access" },
  'terminals.empty': { sq: "Asnjë terminal i regjistruar", en: "No terminals registered" },
  'terminals.emptyHint': { sq: "Regjistro një pajisje për ta identifikuar në sesionet e restorantit.", en: "Register a device to identify it in restaurant sessions." },
  'audit.loading': { sq: "Duke ngarkuar historikun…", en: "Loading history…" },
  'audit.colTime': { sq: "Koha", en: "Time" },
  'audit.colAction': { sq: "Veprimi", en: "Action" },
  'audit.colRecord': { sq: "Regjistrimi", en: "Record" },
} as const;

export type MessageKey = keyof typeof MESSAGES;
