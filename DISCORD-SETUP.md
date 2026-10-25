# دليل إعداد Security Systemix

هذا الدليل يربط **بوت Discord فقط** بخدمة Render ولوحة التحكم. لا يوجد أي ربط بـFiveM. لا ترسل Bot Token أو Client Secret أو كلمة مرور MySQL أو كلمة مرور المالك في المحادثة أو GitHub.

## 1. ربط Discord OAuth

1. افتح Discord Developer Portal للتطبيق ذي Application ID `1562540070802563162`.
2. في **OAuth2 → General → Redirects** أضف الرابط التالي كما هو تماماً:
   `https://security-systemix-sy.onrender.com/api/discord/callback`
3. في Render → خدمة **Security-Systemix-sy** → **Environment** تأكد من وجود `DISCORD_CLIENT_ID` و`DISCORD_CLIENT_SECRET` و`DISCORD_REDIRECT_URI`، وأن قيمة redirect تطابق الرابط أعلاه حرفياً. خزّن Client Secret في Render فقط.
4. يحتاج تسجيل الدخول إلى نطاقي OAuth `identify` و`guilds`. عند العودة من Discord، اختر سيرفراً تملكه أو لديك فيه صلاحية الإدارة.

إذا غيّرت نطاق الموقع لاحقاً، حدّث قيمة `DISCORD_REDIRECT_URI` وقائمة Redirects في Developer Portal معاً.

## 2. إعداد تطبيق البوت وصلاحياته

1. في Developer Portal → **Bot** خذ Bot Token واحفظه في Render باسم `DISCORD_BOT_TOKEN` فقط. لا تستخدم Client Secret مكانه؛ هما قيمتان مختلفتان.
2. من صفحة Bot فعّل **Server Members Intent** و**Message Content Intent** إذا كنت تريد وظائف مكافحة الغارات والسبام المعتمدة عليهما.
3. قيمة `SYSTEMIX_PRIVILEGED_INTENTS=auto` هي سياسة التفاوض الافتراضية: يحاول Gateway تشغيل Members وMessage Content معاً، ثم كل واحد منفرداً، ثم يعمل من دون الاثنين إذا رفض Discord الصلاحية. لذلك تعرض اللوحة الحالة الفعلية المقبولة؛ وجود الإعداد في Portal وحده لا يثبت نجاحه.
   - `members`: يطلب Members فقط.
   - `none`: يعطل الـIntents المميزة.
4. أضف البوت إلى **سيرفر تجريبي تملكه** باستخدام OAuth2 scopes `bot` و`applications.commands`. لا تمنحه `Administrator` تلقائياً. امنحه أقل صلاحيات لازمة بعد مراجعة إجراءات الوحدات؛ تأكد أيضاً من ترتيب رتبته أعلى من الرتب التي يحتاج إدارتها، لكن أسفل رتبة المالك.
5. ابدأ في نمط المراقبة على سيرفر تجريبي. اختبر الصلاحيات والحدود والتسجيل قبل تجربة أي عقوبات.

## 3. قاعدة البيانات: ماذا أضع في `DATABASE_URL`؟

قاعدة البيانات هي مخزن إعدادات السيرفر وسجلات التدقيق، وليست كلمة مرور Discord. المشروع يستخدم **MySQL** عبر Drizzle و`mysql2`؛ رابط PostgreSQL من Render لا يعمل مع هذا الكود.

إذا لم تكن لديك قاعدة MySQL مستضافة، اترك `DATABASE_URL` فارغاً ولا تكتب كلمة أو قيمة تجريبية. اختر مزود MySQL، أنشئ قاعدة ومستخدم اتصال، ثم انسخ **رابط الاتصال MySQL الكامل** من صفحة المزود إلى حقل `DATABASE_URL` في Render. يجب أن يحتوي الرابط على معلومات المضيف والمنفذ واسم القاعدة وبيانات المستخدم، وقد يرفق المزود إعداد TLS. لا تشارك الرابط هنا لأنه يتضمن كلمة مرور القاعدة.

إذا استخدمت Aiven MySQL، نزّل شهادة CA من صفحة الخدمة **Overview → Connection information → CA Certificate → Download**. أضف محتوى ملف PEM كاملاً إلى متغير Render `DATABASE_CA_CERT`، مع إبقاء أسطر الشهادة كما هي ودون علامات اقتباس. يحتاج التحقق الآمن من شهادة Aiven إلى CA الخاص بالمشروع؛ لا تعطل فحص الشهادة أو تستخدم `rejectUnauthorized=false`.

بعد وضع الرابط في Render، أضف `SYSTEMIX_AUTO_MIGRATE=true`. عند إعادة البناء/التشغيل سيحاول التطبيق إنشاء جداول Systemix في القاعدة المتصلة. هذا الخيار لا ينشئ حساب قاعدة البيانات أو القاعدة لدى المزود، ولا يحول قاعدة PostgreSQL إلى MySQL.

## 4. قائمة Render Environment

في Render → **Security-Systemix-sy → Environment** راجع الأسماء التالية. أدخل القيم السرية مباشرة في حقول Render ولا تضعها في ملفات Git:

| المفتاح | ما يوضع فيه |
| --- | --- |
| `DISCORD_CLIENT_ID` | `1562540070802563162` |
| `DISCORD_CLIENT_SECRET` | Client Secret من تطبيق Discord نفسه |
| `DISCORD_REDIRECT_URI` | `https://security-systemix-sy.onrender.com/api/discord/callback` |
| `DISCORD_BOT_TOKEN` | Bot Token من تبويب Bot في Developer Portal |
| `DATABASE_URL` | رابط اتصال قاعدة MySQL فعلية؛ ليس PostgreSQL ولا قيمة تجريبية |
| `DATABASE_CA_CERT` | شهادة CA بصيغة PEM من Aiven عند استخدامه؛ لا تضع فيها رابط الاتصال أو كلمة المرور |
| `SYSTEMIX_AUTO_MIGRATE` | `true` على Render بعد توفير قاعدة MySQL |
| `SYSTEMIX_PRIVILEGED_INTENTS` | `auto` عادةً؛ يختار الـIntents التي يقبلها Discord |
| `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY` | `true` لتشغيل البوت في الإنتاج، و`false` لإيقافه. لا تستخدم `true` إلا بعد جاهزية القاعدة واختبار السيرفر والاستضافة المستمرة |
| `MANUS_JWT_SECRET` | سر جلسة عشوائي طويل؛ أنشئه من Render Generate، ولا ترسله لأحد |

لا تحتاج `MANUS_OAUTH_API_URL` لتسجيل دخول Discord على Render؛ تسجيل Manus اختياري ومخصص لاستضافة Manus.

## 5. متى يمكن تشغيل Gateway؟

يبقى Gateway الإنتاجي محجوباً عمداً حتى ينجح اتصال القاعدة والترحيلات. افحص:

- `https://security-systemix-sy.onrender.com/api/health` — يثبت أن خادم الويب يرد فقط.
- `https://security-systemix-sy.onrender.com/api/ready` — يجب أن يعيد `ready` قبل التفكير بتشغيل Gateway؛ 503 يعني أن القاعدة أو migrations غير جاهزة.
- لوحة الموقع → **مركز تشغيل البوت** — تعرض حالة Gateway وIntents ومزامنة Slash بصورة فعلية.

إذا ظهر `HANDSHAKE_SSL_ERROR` في سجلات Render مع Aiven، راجع وجود شهادة CA الصحيحة في `DATABASE_CA_CERT`؛ اترك Gateway الإنتاجي مغلقاً حتى يصبح `/api/ready` جاهزاً.

لا تضبط `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY=true` إلا بعد أن تصبح `/api/ready` جاهزة، وتجرب تسجيل OAuth وتثبيت البوت ومزامنة Slash والصلاحيات على Guild تملكه، وتختار استضافة مناسبة لتشغيل Gateway باستمرار. خطة Render الحالية Free؛ وفق توثيق Render، خدمة الويب المجانية قد تتوقف عند الخمول، لذلك لا تَعِد بتوفر 24/7 عليها. لا تتم أي ترقية مدفوعة دون مراجعة التكلفة والموافقة عليها.

## 6. إعداد صفحة المالك بكلمة مرور خاصة

الصفحة المباشرة: `https://security-systemix-sy.onrender.com/owner`. وهي تتطلب **حساب Discord مسجلاً + Discord User ID ضمن قائمة السماح + كلمة مرور المالك**. لا تكفي صلاحية `Manage Guild` وحدها. الصفحة الحالية للقراءة التشغيلية فقط؛ لا تشغل Gateway ولا تغيّر أسرار Render.

1. في Discord فعّل **Developer Mode** من الإعدادات المتقدمة، ثم انسخ **User ID** لحسابك. أضف المعرف الرقمي إلى `SYSTEMIX_OWNER_DISCORD_IDS` في Render → الخدمة → **Environment**. يمكن فصل أكثر من معرف بفاصلة؛ استخدم ID وليس اسم الحساب.
2. أنشئ كلمة مرور من 20 إلى 128 حرفاً. شغّل `pnpm owner:hash-password` في Terminal تفاعلي داخل المشروع أو Render Shell؛ اكتب كلمة المرور في prompt المخفي. انسخ ناتج `scrypt$...` فقط إلى `SYSTEMIX_OWNER_PASSWORD_HASH`. لا تحفظ النص الأصلي أو الـhash في Git أو ترسله في المحادثة.
3. تأكد من وجود `MANUS_JWT_SECRET` في Render؛ لا تضع قيمته في الكود. احفظ Environment وشغّل **Save, rebuild, deploy**.
4. افتح الرابط أعلاه، سجّل الدخول بحساب Discord نفسه الذي أضفته، ثم أدخل كلمة المرور الأصلية (وليس الـhash).

تستخدم اللوحة hash مملحاً بـscrypt وقائمة سماح وهوية Discord، وجلسة قصيرة وقيود محاولات؛ وليست TOTP أو WebAuthn. حد المحاولات الحالي بذاكرة نسخة الخدمة الواحدة؛ يلزم مخزن مركزي قبل التوسع لعدة نسخ. إزالة المعرف من القائمة أو تغيير hash كلمة المرور يبطل الجلسات القديمة.

## 7. تشغيل نظام التذاكر: فتح، وسيط، ورفع مستوى

بعد نشر نسخة نظام التذاكر الجديدة، نفّذها مرة واحدة في **سيرفر تملكه**:

1. أنشئ أو حدد رتبة لفريق الدعم، مثل `Support`. لا تستخدم `@everyone` ولا رتبة يملكها تطبيق آخر.
2. في أي قناة داخل السيرفر اكتب: `/ticket setup` ثم اختر تلك الرتبة في حقل **support-role** واضغط إرسال. يجب أن تكون مالك السيرفر أو تملك `Manage Server`، ويجب أن يملك البوت `Manage Channels` و`Send Messages`.
3. ينشئ البوت تلقائياً Category باسم `🎫・systemix-tickets` وقناة لوحة باسم `🎫・open-ticket`، يفعّل التذاكر، ويضع لوحة الاختيارات داخل القناة.
4. لا تنشئ القنوات الثلاث يدوياً. سيظهر للعميل ثلاثة اختيارات: **فتح تذكرة**، **تذكرة وسيط**، و**تذكرة رفع مستوى**. كل اختيار ينشئ قناة خاصة بالاسم `open-ticket-رقم` أو `middleman-ticket-رقم` أو `levelup-ticket-رقم` تحت فئة التذاكر.
5. إذا حذفت لوحة الاختيار أو أردت تحديثها فقط، استخدم `/ticket panel`.

لا يتم حفظ نصوص محادثات التذاكر أو إرسال Transcript في هذه النسخة. يختبر البوت الحجز الذري لحد التذاكر، ولا يعد بنجاح فتح أو إغلاق إذا أخفقت قاعدة البيانات أو Discord.

## 8. ما الذي يمكن الإعلان عنه اليوم؟

يمكن الإعلان عن **مشروع قيد التطوير وواجهة معاينة** أو دعوة قائمة انتظار فقط. لا تقل إن البوت يحمي سيرفرات العملاء فعلياً، ولا تفتح بيع اشتراك أو تعد بتوفر مستمر قبل ربط قاعدة البيانات وإثبات `/api/ready` واختبار OAuth وGateway والوحدات وسجل التدقيق على Guild حقيقي واستضافة مناسبة.

استخدم [`ANNOUNCEMENT-DRAFT-AR.md`](./ANNOUNCEMENT-DRAFT-AR.md) للنص المقترح، وراجع [`RELEASE-READINESS-AR.md`](./RELEASE-READINESS-AR.md) قبل أي إعلان عن الجاهزية.
