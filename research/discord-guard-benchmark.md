# مرجع ميزات حماية Discord — Security Systemix

> أُعدّ هذا الملخص في 20 أكتوبر 2026 من الصفحات الرسمية المتاحة وقت البحث. هو مصدر إلهام وتصميم، لا دعوة لاستنساخ الكود أو العلامات. انظر صفحات المصدر للتغييرات ولتوافر الميزات حسب الخطط.

## أنماط حماية شوهدت في منتجات Discord

### Wick
يوثق Wick مكافحة Anti-Nuke لتغييرات القنوات والرتب والحظر والطرد والويبهوكات، إلى جانب Panic/Auto-Lockdown، وقيود منح الصلاحيات الخطرة، وQuarantine، وAutoMod يعتمد إشارات تراكمية، وبوابة دخول/تحقق، وصور إعدادات يمكن استخدامها لاستعادة بعض بنية الخادم. يجب أن تظل حدود الاستعادة صريحة: توثيقه يستثني الرسائل وتعيينات الأدوار من بعض أنواع اللقطات، كما أن الكفاية تعتمد على التفعيل والإعداد الصحيح. تختلف الميزات حسب الباقة.

المصادر: [Wick Features](https://docs.wickbot.com/intro/features/)، [What is Wick](https://docs.wickbot.com/intro/what-is-wick/)، [Setup Wizard](https://docs.wickbot.com/setup/)، [Quarantine](https://docs.wickbot.com/commands/moderation/quarantine/).

### Beemo
يركز Beemo على كشف userbot raids وحظر الحسابات المشبوهة آلياً، ويقدم سجلات وأوامر إشراف وأرشفة أدلة في باقات مدفوعة. لا نعتبره مرجعاً موثقاً لـAnti-Nuke أو تحقق CAPTCHA أو استعادة بنية الخادم؛ صفحات المنتج المفحوصة لا تثبتها. الخوارزمية نفسها غير قابلة للضبط بالكامل وقد تفوّت هجوماً.

المصادر: [الموقع الرسمي](https://beemo.gg/)، [الوثائق والإعداد](https://docs.beemo.gg/)، [الاشتراكات](https://beemo.gg/subscribe)، [الأرشيف](https://docs.beemo.gg/moderation/archives.html).

### Security Bot
يمزج عدادات Anti-Nuke محددة ضمن نافذة زمنية، مكافحة Raid بدرجات مخاطرة، تحققاً عبر CAPTCHA، إعداد صلاحيات داخلياً للأوامر، وإشرافاً وسجلات. هذا المثال يبرز قيمة منح أوامر محدودة دون منح Manage Server للمشرف. يبقى التطبيق خاضعاً لترتيب أدوار Discord، وقوائم السماح، وصلاحيات التطبيق؛ بعض الحمايات مدفوعة.

المصادر: [Security Bot](https://securitybot.gg/)، [Anti-Nuke Overview](https://docs.securitybot.gg/anti-nuke/anti-nuke)، [Verification](https://docs.securitybot.gg/other-modules/verification)، [Moderation](https://docs.securitybot.gg/other-modules/moderation)، [Premium](https://securitybot.gg/premium).

### Dyno
يوثق Automod معدلات، تكراراً، منشنات، روابط وكلمات، مع عقوبات متعددة؛ ويوفر قفل القنوات وسجلات الأحداث والأوامر وReaction Roles المستخدمة أحياناً للتحقق. يذكر الدعم أن Dyno لا يوفر حماية Anti-Nuke صريحة ضد إساءة صلاحيات المشرفين؛ كما لا يستطيع منع الرسالة قبل أن تصل، وأحداث السجل قد تعتمد على الصلاحيات والذاكرة المؤقتة. لذلك فصل المراقبة والاحتواء عن الادعاء بمنع الحدث.

المصادر: [FAQ](https://docs.dyno.gg/en/faq)، [Automod](https://docs.dyno.gg/modules/automod)، [Moderation](https://docs.dyno.gg/modules/moderation)، [Action Log](https://docs.dyno.gg/modules/actionlog)، [Reaction Roles](https://docs.dyno.gg/modules/reactionroles).

### Carl-bot
يوثق Automod معدلات وروابط ودعوات وكلمات ومنشنات، وتدرج إجراءات الحذف والتحذير والكتم/Timeout والطرد والحظر، وسجلات ومراجعة مخالفات/إحالة للمشرفين، وLockdown قابل للإعداد. يوضح التوثيق أن الـLockdown يعتمد على أذونات القنوات والأدوار. سجل تغييرات القنوات لا يعني أنه يوقف Anti-Nuke أو يستعيد خادماً كاملاً؛ لم تثبت الوثائق المفحوصة هذه القدرات.

المصادر: [Automod](https://docs.carl.gg/automod.md)، [Moderation وLockdown](https://docs.carl.gg/moderation.md)، [Logging](https://docs.carl.gg/logging.md)، [Roles](https://docs.carl.gg/roles.md)، [Premium](https://carl.gg/get-premium).

### Sapphire
يوثق Auto Moderation بشروط وإجراءات متعددة، Join Guard لفحص أعضاء جدد وفق شروط مثل عمر الحساب أو اسم/صورة افتراضية، وسجلات وصلاحيات متقدمة، وبعض نسخ إعدادات البوت. Join Guard ليس بالضرورة كاشفاً لمعدل Raid، وشروطه قد تنتج إيجابيات كاذبة. النسخ الاحتياطية الموثقة تخص إعدادات Sapphire، لا كل كائنات خادم Discord.

المصادر: [Auto Moderation](https://docs.sapph.xyz/automoderation.md)، [Join Guard](https://docs.sapph.xyz/guides/join-guard.md)، [Moderation](https://docs.sapph.xyz/moderation.md)، [Logging](https://docs.sapph.xyz/logging.md)، [General Settings](https://docs.sapph.xyz/generalsettings.md).

### YAGPDB
يمتاز Automoderator بمحرك شروط وإجراءات قابلة للتركيب، وفلاتر معدل/روابط/منشنات، وreCAPTCHA عبر DM، وتسجيل الحالات وبعض الأدلة، مع إجراءات موقتة. لا تثبت الصفحات المفحوصة Anti-Nuke أو استعادة الخادم كاملة. توجد حدود حجم للقواعد والاحتفاظ بالسجل، كما قد يتطلب فحص الرسائل أو سجلات الأحداث صلاحيات وبيانات إضافية.

المصادر: [Advanced Automoderator](https://help.yagpdb.xyz/docs/moderation/advanced-automoderator/overview/)، [Triggers](https://help.yagpdb.xyz/docs/moderation/advanced-automoderator/triggers/)، [Effects](https://help.yagpdb.xyz/docs/moderation/advanced-automoderator/effects/)، [Verification](https://help.yagpdb.xyz/docs/moderation/verification/)، [Moderation & Logging](https://help.yagpdb.xyz/docs/moderation/moderation-tools/).

### ProBot
يوثق حماية Raid بحدود زمنية وعمر الحساب، AutoMod يستخدم قواعده وDiscord AutoMod بحسب الحالة، VIP Protection لتقييد بعض التصرفات الإدارية، وأوامر إشراف وسجلات متنوعة. Anti-Raid وبعض قواعد الحماية مرتبطة بالخطة. بعض حماية السبام تعتمد على Discord AutoMod نفسه وليست كلها ماسح رسائل من البوت.

المصادر: [Anti-Raid](https://docs.probot.io/docs/modules/anti_raid)، [Automod](https://docs.probot.io/docs/modules/automod)، [VIP Protection](https://docs.probot.io/docs/modules/vip_protection)، [Logs](https://docs.probot.io/docs/modules/logs)، [Commands](https://docs.probot.io/docs/getting-started/commands).

### Double Counter وAltDentifier
يوثّق الموقع الحالي Double Counter فحص الانضمام للبدائل وإشارات VPN/Tor/proxy والبوتات، بتحدي CAPTCHA أو تحقق رابط وقرار قابل للتخصيص، مع لوحة وسجلات مخاطر. هذه إشارات تعتمد على تدفق تحقق وخدماته، وليست متاحة تلقائياً من Discord API. صفحات المصادر لا تثبت Anti-Nuke أو ماسح رسائل أو استعادة خادم. نطاق AltDentifier الحالي يحيل إلى Double Counter؛ لذلك نُسبت التفاصيل للموقع الحالي بحذر.

المصادر: [Double Counter](https://doublecounter.gg/)، [Getting Started](https://docs.doublecounter.gg/)، [FAQ](https://doublecounter.gg/faq)، [Pro](https://doublecounter.gg/pro)، [Discord App Directory: Double Counter](https://discord.com/discovery/applications/703886990948565003)، [Discord App Directory: AltDentifier](https://discord.com/discovery/applications/372022813839851520)، [altdentifier.com](https://altdentifier.com/).

## عناصر مشتركة تستحق البناء

الوظائف المتكررة عبر المنتجات القوية تشمل عتبات متحركة لـAnti-Nuke/Raid، إشارات دخول متنوعة لا تُعامل كل واحدة كدليل نهائي، احتواء قابل للضبط، فلاتر رسائل ذات استثناءات، تحقق بوابة وصول، Timeout/تحذير/طرد/حظر، سجلات وقنوات تنبيه، قوائم سماح، وضبط متدرج لصلاحيات الموظفين. ما يميز Security Systemix سيكون جعل هذه الوظائف مترابطة في «نبض تهديد» مفسر و«قاطع هجوم» آمن، وتفويض كل إجراء بحدود دقيقة، ومعاينة أثر التغيير قبل إنفاذه.

## حدود Discord التي توجه التصميم

- [ترتيب الرتب والصلاحيات](https://docs.discord.com/developers/topics/permissions): البوت يستطيع إدارة الرتب/الأعضاء الواقعة دون أعلى رتبة له فقط، ولا يمنح صلاحية لم تتوفر له؛ أذونات القنوات قد تتعارض مع الصلاحيات العامة.
- [Gateway Intents](https://docs.discord.com/developers/events/gateway): صلاحيات أعضاء الخادم والحضور ومحتوى الرسائل من intents مميزة؛ يلزم تفعيلها، وقد تلزم موافقة Discord للتطبيقات التي تبلغ حد التحقق. نطلب فقط ما تحتاجه ميزة فعلاً.
- [OAuth2](https://docs.discord.com/developers/topics/oauth2): يلزم تثبيت client ID/secret بطريقة آمنة، والتحقق من `state` لمنع CSRF؛ حسابات البوت منفصلة عن المستخدمين، ودعوة البوت تتطلب إذن المستخدم المناسب.
- [حدود API](https://docs.discord.com/developers/topics/rate-limits): معدلات الطلبات تتغير حسب المسار، لذا يجب قراءة رؤوس rate-limit واتباع `Retry-After`، لا افتراض حد ثابت.


## متطلبات التنفيذ الحي — مراجعة 21 أكتوبر 2026

- حدث `GUILD_AUDIT_LOG_ENTRY_CREATE` يصل للبوت الذي يملك `VIEW_AUDIT_LOG`. أحداث Auto Moderation لا تصل إلا للبوت الذي يملك `MANAGE_GUILD`. الحدث لا يضمن توافر كل الحقول؛ يجب التعامل مع بيانات جزئية.[1] [2]
- أحداث انضمام الأعضاء تتطلب `GUILD_MEMBERS` وهو Intent مميز؛ يجب تمكينه من Developer Portal، وقد تتطلب التطبيقات الكبيرة مراجعة Discord. الإصدار الأول يتجنب `MESSAGE_CONTENT` ويستخدم قواعد Discord AutoMod الأصلية بدلاً من جمع محتوى الرسائل. محتوى `content` و`matched_content` في أحداث AutoMod يتطلب `MESSAGE_CONTENT`.[1] [2]
- OAuth2 يستخدم Authorization Code ويجب ربط `state` بطلب المتصفح والتحقق منه. scopes الأساسية لعرض حساب المستخدم وخوادمه هي `identify guilds`; تثبيت البوت يتم بمنح bot scopes مستقلة عن جلسة المستخدم.[3] [4]
- إنشاء وتعديل قواعد AutoMod يتطلب `MANAGE_GUILD`، وإجراء TIMEOUT يتطلب أيضاً `MODERATE_MEMBERS`. لا تطلب الواجهة إجراءً لا يملك البوت صلاحياته.[5]
- Discord يحتفظ بسجل التدقيق 45 يوماً؛ حدود REST متغيرة ويجب اتباع headers و`Retry-After` بدلاً من ترميز معدل ثابت. ترتيب الرتب يحد من قدرة البوت على إدارة الأعضاء والرتب الأعلى منه.[6] [7] [8]

[1]: https://docs.discord.com/developers/events/gateway "Gateway API and intents"
[2]: https://docs.discord.com/developers/events/gateway-events "Gateway events and permissions"
[3]: https://docs.discord.com/developers/topics/oauth2 "Discord OAuth2"
[4]: https://docs.discord.com/developers/platform/oauth2-and-permissions "OAuth2 install scopes and bot permissions"
[5]: https://docs.discord.com/developers/resources/auto-moderation "Auto Moderation API"
[6]: https://docs.discord.com/developers/resources/audit-log "Audit Log API"
[7]: https://docs.discord.com/developers/topics/rate-limits "Discord API rate limits"
[8]: https://docs.discord.com/developers/topics/permissions "Permissions and role hierarchy"
