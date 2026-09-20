import { useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  Server,
  Terminal,
  Users,
} from 'lucide-react';

import { TelegramGlyph } from '@/components/Brand';
import { backendConfigured } from '@/lib/backend';
import { useLanguage } from '@/lib/i18n';
import type { PageKey } from '@/lib/types';

interface Step {
  icon: React.ReactNode;
  title: { en: string; km: string };
  body: { en: string; km: string };
  code?: string;
  goTo?: { page: PageKey; label: { en: string; km: string } };
}

const STEPS: Step[] = [
  {
    icon: <Server className="h-4 w-4" />,
    title: {
      en: '1. Start the userbot service',
      km: '១. ចាប់ផ្តើមសេវា userbot',
    },
    body: {
      en: 'This app is the control panel; the service is what actually talks to Telegram. Without it running, scanning and downloading stay idle. Run it on your PC, or on a small VPS if you want it working overnight.',
      km: 'កម្មវិធីនេះជាផ្ទាំងបញ្ជា ចំណែកសេវាទើបជាអ្នកទាក់ទងជាមួយ Telegram ពិត។ បើវាមិនដំណើរការ ការ scan និងទាញយកនឹងឈប់ទាំងអស់។ អាច run លើកុំព្យូទ័រ ឬលើ VPS បើចង់ឲ្យវាដើរពេលយប់។',
    },
    code: 'cd backend-node\nnpm install\nnpm run login\nnpm start',
  },
  {
    icon: <TelegramGlyph className="h-4 w-4" />,
    title: {
      en: '2. Connect your Telegram account',
      km: '២. ភ្ជាប់គណនី Telegram',
    },
    body: {
      en: 'Get an api_id and api_hash from my.telegram.org, put them in the service\'s .env, then sign in once with npm run login. Settings › Telegram shows which account is connected.',
      km: 'យក api_id និង api_hash ពី my.telegram.org ដាក់ក្នុង .env របស់សេវា រួច login ម្តងជាមួយ npm run login។ ការកំណត់ › Telegram នឹងបង្ហាញគណនីដែលបានភ្ជាប់។',
    },
    goTo: { page: 'settings', label: { en: 'Open Settings', km: 'បើកការកំណត់' } },
  },
  {
    icon: <Cloud className="h-4 w-4" />,
    title: {
      en: '3. Connect Cloudflare R2 (optional)',
      km: '៣. ភ្ជាប់ Cloudflare R2 (មិនចាំបាច់)',
    },
    body: {
      en: 'R2 is where downloaded videos are stored. Paste the credentials in Settings › R2 and press Test Connection — it really reaches the bucket, so a green result means it works. Forwarding does not need R2 at all.',
      km: 'R2 ជាកន្លែងរក្សាទុកវីដេអូដែលទាញយក។ បញ្ចូល credentials ក្នុង ការកំណត់ › R2 រួចចុច Test Connection — វាភ្ជាប់ទៅ bucket ពិត ដូច្នេះបើបៃតង គឺដំណើរការ។ ការបញ្ជូនបន្តមិនត្រូវការ R2 ទេ។',
    },
    goTo: { page: 'settings', label: { en: 'Open Settings', km: 'បើកការកំណត់' } },
  },
  {
    icon: <Users className="h-4 w-4" />,
    title: {
      en: '4. Add a group and scan it',
      km: '៤. បន្ថែមក្រុម រួច scan',
    },
    body: {
      en: 'Add Group lets you pick from the groups your account is already in, or paste a chat ID. The app confirms the real group name before saving, then scans it for topics and videos.',
      km: 'ប៊ូតុង Add Group អាចជ្រើសពីក្រុមដែលគណនីអ្នកនៅក្នុងស្រាប់ ឬបញ្ចូល chat ID។ កម្មវិធីនឹងបញ្ជាក់ឈ្មោះក្រុមពិតមុនរក្សាទុក រួច scan រក topic និងវីដេអូ។',
    },
    goTo: { page: 'groups', label: { en: 'Open Groups', km: 'បើកក្រុម' } },
  },
  {
    icon: <Download className="h-4 w-4" />,
    title: {
      en: '5. Pick a topic, then pick videos',
      km: '៥. ជ្រើស topic រួចជ្រើសវីដេអូ',
    },
    body: {
      en: 'Click a group to see its topics with how many videos each holds. Click a topic to see the videos, filter by EP range, tick the ones you want, then Download selected. Whole-topic buttons are on each topic card.',
      km: 'ចុចលើក្រុមដើម្បីមើល topic និងចំនួនវីដេអូក្នុងនីមួយៗ។ ចុចលើ topic ដើម្បីមើលវីដេអូ ច្រោះតាម EP ជ្រើសអ្វីដែលចង់បាន រួចចុច Download selected។ ប៊ូតុងសម្រាប់ topic ទាំងមូលមាននៅលើ card នីមួយៗ។',
    },
    goTo: { page: 'groups', label: { en: 'Open Groups', km: 'បើកក្រុម' } },
  },
  {
    icon: <Copy className="h-4 w-4" />,
    title: {
      en: '6. Branch a whole group into a new one',
      km: '៦. បើកសាខាក្រុមទាំងមូលទៅក្រុមថ្មី',
    },
    body: {
      en: 'Open a group and press "Mirror to new group". It creates a matching topic in the destination for every topic that holds videos, then copies each video in episode order. If the source group has content protection on — common for paid groups — Telegram blocks forwarding entirely, and the Automatic copy mode downloads and re-uploads each video instead. That is much slower, so leave the service running.',
      km: 'បើកក្រុមមួយ រួចចុច "Mirror to new group"។ វានឹងបង្កើត topic ដូចគ្នាក្នុងក្រុមថ្មីសម្រាប់រាល់ topic ដែលមានវីដេអូ រួចចម្លងវីដេអូតាមលំដាប់ episode។ បើក្រុមប្រភពបើក content protection (ធម្មតាសម្រាប់ក្រុមបង់ប្រាក់) Telegram ហាមការ forward ទាំងស្រុង ហើយរបៀប Automatic នឹងទាញយករួច upload ជាថ្មីជំនួស។ វិធីនោះយឺតជាងច្រើន ដូច្នេះត្រូវទុកសេវាដំណើរការ។',
    },
    goTo: { page: 'groups', label: { en: 'Open Groups', km: 'បើកក្រុម' } },
  },
];

const FAQ: { q: { en: string; km: string }; a: { en: string; km: string } }[] = [
  {
    q: {
      en: 'Nothing happens when I press Scan',
      km: 'ចុច Scan ហើយគ្មានអ្វីកើតឡើង',
    },
    a: {
      en: 'The userbot service is not reachable. Check the status chips at the top of the Dashboard: if "Service" is grey, the service is not running or VITE_TELEGRAM_BACKEND_URL points somewhere else.',
      km: 'សេវា userbot មិនអាចទាក់ទងបាន។ សូមមើលសញ្ញាស្ថានភាពខាងលើ Dashboard៖ បើ "Service" ជាពណ៌ប្រផេះ មានន័យថាសេវាមិនដំណើរការ ឬ VITE_TELEGRAM_BACKEND_URL ចង្អុលខុសកន្លែង។',
    },
  },
  {
    q: {
      en: 'The site is on Vercel but the service is on my PC',
      km: 'គេហទំព័រនៅលើ Vercel តែសេវានៅលើកុំព្យូទ័រ',
    },
    a: {
      en: 'A browser will not let an HTTPS page call http://localhost. Either run the frontend locally too, or put an HTTPS tunnel in front of the service (cloudflared tunnel --url http://localhost:8000) and use that address.',
      km: 'Browser មិនអនុញ្ញាតឲ្យទំព័រ HTTPS ហៅ http://localhost ទេ។ ត្រូវ run frontend ក្នុងម៉ាស៊ីនដែរ ឬដាក់ HTTPS tunnel មុនសេវា (cloudflared tunnel --url http://localhost:8000) រួចប្រើអាសយដ្ឋាននោះ។',
    },
  },
  {
    q: {
      en: 'A forward failed with a Telegram error',
      km: 'ការបញ្ជូនបន្តបរាជ័យដោយមាន error ពី Telegram',
    },
    a: {
      en: 'Two common causes: the source group has content protection on (forwarding is blocked by Telegram itself), or the account is not a member of the destination group. Forward jobs show the exact error per video.',
      km: 'មូលហេតុទូទៅពីរ៖ ក្រុមប្រភពបើក content protection (Telegram ខ្លួនឯងហាមបញ្ជូនបន្ត) ឬគណនីមិនទាន់ចូលរួមក្រុមទិសដៅ។ ការបញ្ជូនបន្តបង្ហាញ error ជាក់លាក់សម្រាប់វីដេអូនីមួយៗ។',
    },
  },
  {
    q: {
      en: 'The VIP group blocks forwarding',
      km: 'ក្រុម VIP ហាមការ forward',
    },
    a: {
      en: 'That is Telegram\'s content protection, set by the group owner — no tool can forward out of such a group. The way around it is the "Re-upload every video" copy mode: each video is downloaded and sent as a new file. It works, but it moves every byte through your connection, so a large group takes a long time.',
      km: 'នោះជា content protection របស់ Telegram ដែលម្ចាស់ក្រុមកំណត់ — គ្មានឧបករណ៍ណា forward ចេញពីក្រុមបែបនេះបានទេ។ ផ្លូវចេញគឺរបៀប "Re-upload every video"៖ វីដេអូនីមួយៗត្រូវទាញយករួចផ្ញើជាឯកសារថ្មី។ វាដំណើរការ តែទិន្នន័យទាំងអស់ត្រូវឆ្លងកាត់អ៊ីនធឺណិតរបស់អ្នក ដូច្នេះក្រុមធំត្រូវការពេលយូរ។',
    },
  },
  {
    q: {
      en: 'Can I make downloads faster or forwards 100% guaranteed?',
      km: 'តើអាចធ្វើអោយទាញយកលឿនជាង ឬធានា forward បាន 100% ដែរឬទេ?',
    },
    a: {
      en: 'Partly, honestly. Telegram enforces its own per-account speed limit (FLOOD_WAIT) on its servers — no app, this one or the official Telegram client, can turn that off; claiming otherwise would be false. What this service does do: downloads already run on up to 8 parallel connections per file and grow automatically, MAX_CONCURRENT_DOWNLOADS has no built-in ceiling (raise it as high as your machine allows), and every download or forward that does hit a FLOOD_WAIT now waits out the exact time Telegram asks and retries automatically, up to 6 times, instead of just failing. A source group with content protection still blocks real forwarding no matter what — the "Re-upload every video" copy mode is the actual way around that, not a faster retry.',
      km: 'ពិតជាបានផ្នែកខ្លះ ប៉ុន្តែសូមនិយាយត្រង់ៗ។ Telegram កំណត់ល្បឿនផ្ទាល់លើ server របស់វា (FLOOD_WAIT) ចំពោះគណនីនីមួយៗ — គ្មាន app ណាមួយ ទោះជា app នេះ ឬ Telegram ផ្លូវការ អាចបិទវាបានទេ។ អ្វីដែលសេវានេះពិតជាធ្វើ៖ ការទាញយកប្រើ connection ស្របគ្នារហូតដល់ 8 ក្នុងឯកសារមួយ និងកើនដោយស្វ័យប្រវត្តិ, MAX_CONCURRENT_DOWNLOADS គ្មានដែនកំណត់ក្នុងកូដទេ (កំណត់តាមចិត្តអ្នកតាមកម្លាំងម៉ាស៊ីន), ហើយរាល់ការទាញយក ឬ forward ដែលជួប FLOOD_WAIT ឥឡូវនេះនឹងរង់ចាំគ្រប់ចំនួនវិនាទីដែល Telegram ស្នើ រួចព្យាយាមម្តងទៀតដោយស្វ័យប្រវត្តិ រហូតដល់ 6 ដង ជំនួសឲ្យការបរាជ័យភ្លាម។ ក្រុមដែលបើក content protection នៅតែហាម forward ពិតប្រាកដ — របៀប "Re-upload every video" ទើបជាដំណោះស្រាយពិត មិនមែនការព្យាយាមឡើងវិញលឿនជាងនោះទេ។',
    },
  },
];

export function GuidePage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { language } = useLanguage();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const pick = (pair: { en: string; km: string }) => (language === 'km' ? pair.km : pair.en);

  return (
    <div className="space-y-4 animate-fade-in">
      {!backendConfigured && (
        <div className="flex items-start gap-2 rounded-xl border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {language === 'km'
              ? 'មិនទាន់មាន userbot service ភ្ជាប់ទេ — សូមធ្វើតាមជំហានទី ១ ខាងក្រោម។'
              : 'No userbot service is connected yet — start with step 1 below.'}
          </span>
        </div>
      )}

      <ol className="space-y-3">
        {STEPS.map((step, index) => (
          <li key={index} className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary-500/20 bg-primary-500/10 text-primary-400">
                {step.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white">{pick(step.title)}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-dark-400">{pick(step.body)}</p>

                {step.code && (
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-dark-800 bg-dark-950 p-3 font-mono text-[11px] leading-relaxed text-dark-300">
                    <code>{step.code}</code>
                  </pre>
                )}

                {step.goTo && (
                  <button
                    onClick={() => onNavigate(step.goTo!.page)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-dark-800 px-3 py-1.5 text-[11px] font-medium text-dark-300 transition-colors hover:bg-primary-500 hover:text-white"
                  >
                    {pick(step.goTo.label)} <ExternalLink className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-dark-800 bg-dark-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Terminal className="h-4 w-4 text-accent-400" />
          {language === 'km' ? 'បញ្ហាដែលជួបញឹកញាប់' : 'Common problems'}
        </h3>
        <div className="space-y-1.5">
          {FAQ.map((item, index) => {
            const isOpen = openFaq === index;
            return (
              <div key={index} className="overflow-hidden rounded-lg bg-dark-800/30">
                <button
                  onClick={() => setOpenFaq(isOpen ? null : index)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-medium text-dark-200 transition-colors hover:bg-dark-800/60"
                >
                  {pick(item.q)}
                  <span className="shrink-0 text-dark-500">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <p className="px-3 pb-3 text-[11px] leading-relaxed text-dark-400">{pick(item.a)}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
