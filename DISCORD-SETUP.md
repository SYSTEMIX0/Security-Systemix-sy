# إعداد Security Systemix مع Discord

## قبل أن تبدأ

Security Systemix بوت Discord فقط؛ لا يتكامل مع FiveM. الكود يحتوي وحدات Anti-Nuke وAnti-Raid وAnti-Spam وAutoMod وغيرها، لكن وجود الوحدة في المصدر لا يعني أن كل شاشة إدارة موصولة أو أن البوت اختُبر في سيرفر حي. لا تعتبر النسخة جاهزة للبيع قبل اختبار OAuth والـGateway والصلاحيات والإجراءات في Guild تجريبي تملكه.

صفحة **الحماية** في Dashboard تقرأ وتكتب إعدادات السيرفر المحدد. كل حفظ يحتاج تأكيداً ظاهراً، والخادم يسجل نية التغيير في قاعدة التدقيق قبل حفظ الإعدادات؛ إذا فشل التسجيل يرفض الحفظ. اختيار نمط `protect` يتطلب تأكيداً أقوى من `observe`. النمط `observe` هو البداية الآمنة: يرصد ويسجل دون فرض عقوبات تلقائية.

## إعداد تطبيق Discord

1. افتح [Discord Developer Portal](https://discord.com/developers/applications/1562540070802563162) للتطبيق المعتمد لـSecurity Systemix: `1562540070802563162`.
2. من **OAuth2 → General** أضف Redirect URI هذا حرفياً ثم احفظه:
   `https://systemix-hc3hycno.manus.space/api/discord/callback`
   تسجيل الدخول من Preview المستضاف على `*.manus.computer` يحوّل إلى الموقع المنشور ويعود إليه بعد OAuth. لا تضف Redirect خاصاً بالـPreview اعتماداً على الزر الحالي؛ يتطلب ذلك تغييراً صريحاً في تدفق OAuth.
3. من **OAuth2 → Client Secret** أنشئ/انسخ قيمة Client Secret، ومن **Bot** انسخ Bot Token. هذان سرّان مختلفان؛ لا ترسلهما في المحادثة ولا تضعهما في GitHub أو صورة شاشة.
4. أدخل `DISCORD_CLIENT_SECRET` و`DISCORD_BOT_TOKEN` عبر بطاقة الأسرار الآمنة في المشروع. `DISCORD_CLIENT_ID` عام وموجود في الكود بقيمة `1562540070802563162`.
5. يستخدم تسجيل الدخول نطاقي OAuth `identify` و`guilds` فقط؛ لا نطلب صلاحية دخول المستخدم إلى السيرفر أو تغيير حسابه.

إذا ظهرت حالة `bot_application_id_mismatch`، فالتوكن يعود إلى تطبيق Discord مختلف عن Application ID؛ يجب أن يكون Client Secret وBot Token كلاهما من التطبيق أعلاه. يوقف Systemix Gateway تلقائياً عند عدم التطابق ولا يسجل أوامر Slash.

## الصلاحيات وIntents

- رابط الدعوة الذي يولده المشروع لا يطلب **Administrator**. لكنه يطلب مجموعة صلاحيات إدارية تشمل بحسب المصدر: `ViewAuditLog` و`ManageGuild` و`ManageRoles` و`ManageChannels` و`ManageMessages` و`ManageWebhooks` و`KickMembers` و`BanMembers` و`ModerateMembers` وبعض صلاحيات القنوات والصوت. راجع شاشة Discord قبل الموافقة، ولا تمنح صلاحية أوسع من اللازم. إذا سبق ومنحت Administrator، أعد مراجعة صلاحيات البوت وخفّضها إلى ما تحتاجه الوحدات التي ستختبرها.
- `ViewAuditLog` مطلوب لإشارات Anti-Nuke. يحتاج تنفيذ العقوبات إلى الأذونات المناسبة، كما يجب أن يكون أعلى دور للبوت أعلى من دور المستهدف. لا يتجاوز Systemix مالك السيرفر أو قيود ترتيب الرتب.
- Anti-Raid يحتاج `Guild Members Intent` لمراقبة دخول الأعضاء. يحاول Gateway استخدام الـIntents المميزة المتاحة ثم يعود إلى مجموعة أقل عند رفض Discord؛ تظهر الحالة الفعلية في لوحة الربط. فعّل الـIntents من **Bot → Privileged Gateway Intents** قبل توقع ميزات تتطلبها.
- ميزات قراءة نص الرسائل تعتمد على `Message Content Intent` وتوفره في تطبيق Discord؛ عند غيابه تُقيّد قواعد النصوص، ولا ينبغي ادعاء اكتمال فحص محتوى الرسائل. لا يخزن المشروع محتوى الرسائل الخام في قاعدة التدقيق.

## تجربة آمنة

1. اختبر أولاً على سيرفر تجريبي تملكه، وليس على مجتمع العملاء.
2. افتح لوحة Security Systemix واختر **ربط Discord** ثم وافق بحساب يملك صلاحية إدارة السيرفر، واختر السيرفر.
3. إن لم يكن البوت في السيرفر، استخدم رابط الدعوة من اللوحة، وراجع الأذونات المعروضة قبل الموافقة.
4. ابدأ بوضع `observe`، ثم فعّل وحدة واحدة فقط، وحدد قنوات التنبيه. اختبر السجلات وحدود الرصد قبل الانتقال إلى `protect`.
5. في نمط `protect` قد تطبق Anti-Nuke عقوبة مختارة (تنبيه، إزالة رتب خطرة قابلة للإزالة، Timeout، طرد أو حظر) بعد تجاوز العتبة. وقد تطبق Anti-Raid الإجراء المحدد عند تحقق إشارات السياسة. تأكد من وجود سبب/قناة مراجعة وصلاحيات وترتيب رتب مناسبين؛ إشارات عمر الحساب أو غياب الصورة ليست وحدها دليلاً قاطعاً.
6. AutoMod منفصل: احفظ إعداداته، ثم اضغط تطبيق/مزامنة واقرأ نافذة التأكيد. تُدار قواعد Systemix المملوكة للتطبيق فقط؛ لا يعدّل البوت قواعد أنشأها مسؤول آخر.
7. اختبر `/systemix status` و`/systemix simulate`. المحاكاة لا تغيّر شيئاً في Discord.
8. افحص سجل التدقيق في لوحة Systemix، ثم جرّب أن تكون قاعدة البيانات غير متاحة فقط في بيئة اختبار معزولة للتأكد من أن الحفظ المرفوض لا يغير الإعدادات. لا توقف قاعدة التطوير/الإنتاج المشتركة لهذا الاختبار.

## تشغيل محلياً

المشروع مُهيأ أساساً لـWebDev؛ قاعدة MySQL ومفتاح جلسة Manus تأتي من بيئة المشروع، وليست في `.env.example`. لا تشغّل `pnpm db:migrate` ضد قاعدة مشتركة لمجرد التجربة؛ قاعدة التطوير والنشر واحدة. التشغيل المحلي الكامل يحتاج بيئة DB ومفتاح جلسة صالحين، ويحتاج Redirect URI مسجلاً في Discord OAuth. لاختبار OAuth محلياً فقط، سجّل `http://localhost:3000/api/discord/callback` وعيّن `SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT=true` مع ذلك العنوان؛ اترك العلم false في الإنتاج. Cookies على `localhost` تكون Lax، بينما HTTPS يستخدم `SameSite=None; Secure`. زر الدخول من Preview المستضاف يوجّه إلى الموقع المنشور؛ اختبار callback مباشرة داخل Preview غير مفعّل حالياً.

في بيئة التطوير يبدأ Gateway إذا توفر `DISCORD_BOT_TOKEN`. عند الاتصال قد يسجل البوت أوامر `/systemix` على السيرفرات الموجودة فيه. لا تضع التوكن في بيئة تطوير إلا إذا كنت تقصد اختبار ذلك على تلك السيرفرات.

## النشر 24/7

اتصال Discord Gateway عملية طويلة العمر؛ Autoscale قد ينام أو يشغّل أكثر من عملية. استضافة Reserved في WebDev هي نمط العملية المستمرة لهذا المشروع. اتصال Gateway في الإنتاج محمي افتراضياً بمتغير `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY=false`. لا تفعّله قبل اختيار نمط استضافة دائم، وتوفير الأسرار عبر القنوات الآمنة، وإكمال الاختبار على Guild تجريبي. تغيير الاستضافة قد يغير استخدام الموارد، ولا يتم تفعيله تلقائياً.

قبل اعتبار المنتج جاهزاً للبيع، أكمل واجهات إدارة المجتمع التي لا تزال معاينة، واختبر كل الوحدات الحية والأذونات والاستجابة للتوقف وإعادة الاتصال في سيرفر تملكه، وحدد سياسة خصوصية واحتفاظ واضحة لسجلات العملاء.

## متغيرات البيئة

راجع [`.env.example`](./.env.example). لا تحفظ `.env` أو Client Secret أو Bot Token في المستودع. في WebDev استخدم إدخال الأسرار الآمن. أبقِ `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY` و`SYSTEMIX_ENABLE_GUILD_MEMBERS_INTENT` على الوضع الآمن ما لم تكن شروط التفعيل المذكورة أعلاه متحققة.

## مراجع Discord الرسمية

- [OAuth2](https://docs.discord.com/developers/topics/oauth2)
- [Permissions and role hierarchy](https://docs.discord.com/developers/topics/permissions)
- [Gateway and intents](https://docs.discord.com/developers/events/gateway)
- [Gateway events](https://docs.discord.com/developers/events/gateway-events)
- [Auto Moderation API](https://docs.discord.com/developers/resources/auto-moderation)
- [Audit Log](https://docs.discord.com/developers/resources/audit-log)
- [Rate limits](https://docs.discord.com/developers/topics/rate-limits)
