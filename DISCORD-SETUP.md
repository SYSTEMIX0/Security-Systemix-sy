# إعداد Security Systemix مع Discord

## حالة هذه النسخة

الكود يحتوي ربط Discord OAuth2، وفحص صلاحية **Manage Server** لكل سيرفر، وGateway لمراقبة سجل التدقيق وإشارات Anti-Raid، وقواعد Discord AutoMod الأصلية، وأمر `/systemix status` و`/systemix simulate`. Auto-Nuke وAnti-Raid في هذا الإصدار **تنبيه وإشارات للمراجعة فقط**؛ لا يحظر البوت ولا يطرد ولا يقفل القنوات تلقائياً. AutoMod لا يغيّر سيرفرك إلا بعد حفظ الإعدادات والضغط على زر المزامنة وتأكيد النافذة.

صفحة مركز الوحدات الأخرى (التذاكر والفعاليات والترحيب والمستويات وغيرها) ما زالت مخططاً/معاينة وليست وظائف حية. لا تسوّق المنتج على أنه اكتمل أو أنه يوفّر هذه الوظائف حتى تنفيذها واختبارها.

## إعداد تطبيق Discord

1. افتح [Discord Developer Portal](https://discord.com/developers/applications/1562540070802563162) للتطبيق المعتمد لـSecurity Systemix: `1562540070802563162`.
2. من **OAuth2 → General** أضف Redirect URI هذا حرفياً ثم احفظه:
   `https://systemix-hc3hycno.manus.space/api/discord/callback`
   هذا هو عنوان الموقع المنشور. تسجيل الدخول من Preview المستضاف على `*.manus.computer` يُحوّل عمداً إلى الموقع المنشور، ويعود إليه بعد OAuth؛ لا يسجل هذا التدفق callback داخل Preview. لا تضف Redirect خاصاً بـPreview اعتماداً على الزر الحالي؛ يتطلب ذلك تغييراً صريحاً في تدفق OAuth.
3. من **OAuth2 → Client Secret** أنشئ/انسخ قيمة Client Secret، ومن **Bot** انسخ Bot Token. هذان سرّان مختلفان؛ لا ترسلهما في المحادثة ولا تضعهما في GitHub أو صورة شاشة.
4. أضف `DISCORD_CLIENT_SECRET` و`DISCORD_BOT_TOKEN` من بطاقة إدخال الأسرار الآمنة في المشروع. `DISCORD_CLIENT_ID` عام وموجود افتراضياً في الكود بقيمة `1562540070802563162`.
5. يستخدم تسجيل الدخول نطاقي OAuth `identify` و`guilds` فقط. لا يطلب صلاحية إرسال المستخدمين إلى السيرفر ولا يرفع امتيازاتهم.

إذا ظهرت حالة `bot_application_id_mismatch`، فالتوكن صالح لكنه يعود إلى تطبيق آخر؛ يجب أن يكون Client Secret وBot Token كلاهما من التطبيق نفسه ذي المعرّف أعلاه. يوقف Systemix Gateway تلقائياً عند عدم التطابق ولا يسجل أوامر Slash.

## صلاحيات البوت وIntents

- لا يحتاج البوت إلى **Administrator**. رابط الدعوة المولّد من اللوحة يطلب الصلاحيات الأساسية فقط: `VIEW_AUDIT_LOG` و`MANAGE_GUILD` و`VIEW_CHANNEL` و`SEND_MESSAGES` (قيمة permissions الحالية: `3232`). سيظهر `/systemix` للمستخدمين الذين لديهم Manage Server.
- `MANAGE_GUILD` مطلوب لمزامنة AutoMod، و`VIEW_AUDIT_LOG` لمراقبة سجل التدقيق. تأكد أيضاً أن قناة التنبيه تسمح للبوت برؤية القناة وإرسال الرسائل.
- Anti-Raid الذي يراقب انضمام الأعضاء يحتاج تفعيل **Server Members Intent** من تبويب **Bot → Privileged Gateway Intents**. لا تفعّل `SYSTEMIX_ENABLE_GUILD_MEMBERS_INTENT=true` إلا بعد تفعيل ذلك في Developer Portal.
- لا يستخدم الإصدار الحالي Message Content Intent، ولا يخزن محتوى الرسائل. لا تفعّله لمجرد التجربة.

## تجربة آمنة

1. اختبر أولاً على سيرفر تجريبي تملكه، وليس على مجتمع العملاء.
2. افتح لوحة Security Systemix واختر **ربط Discord** ثم وافق بحساب يملك Manage Server، واختر السيرفر.
3. إن لم يكن البوت في السيرفر، استخدم رابط الدعوة من اللوحة. لا تستخدم دعوة بصلاحية Administrator.
4. ابدأ بتفعيل Anti-Nuke أو Anti-Raid بوضع المراقبة، واحفظ إعداداتك. اكتب معرّف قناة التنبيه إن أردت وصول التنبيه إليها.
5. AutoMod منفصل: اختر قاعدة، احفظ الإعدادات، اضغط تطبيق/مزامنة، واقرأ نافذة التأكيد. إيقافه يعطّل قواعد Systemix التي يملكها البوت فقط؛ لا يحذف قواعد السيرفر التي أنشأها أشخاص آخرون.
6. اختبر `/systemix status` و`/systemix simulate`. المحاكاة لا تغيّر شيئاً في Discord.

## تشغيل محلياً

المشروع مُهيأ أساساً لـWebDev؛ قاعدة MySQL ومفتاح جلسة Manus تأتي من بيئة المشروع، وليست في `.env.example`. لا تشغّل `pnpm db:migrate` ضد قاعدة مشتركة لمجرد التجربة؛ قاعدة التطوير والنشر واحدة. التشغيل المحلي الكامل يحتاج بيئة DB ومفاتيح جلسة صحيحة، ويحتاج عنوان Redirect URI مسجلاً في Discord OAuth. لاختبار OAuth محلياً فقط، سجّل `http://localhost:3000/api/discord/callback` وعيّن `SYSTEMIX_ALLOW_LOCAL_HTTP_REDIRECT=true` مع ذلك العنوان؛ اترك العلم false في الإنتاج. Cookies على `localhost` تكون Lax، بينما HTTPS يستخدم `SameSite=None; Secure`. في Preview المستضاف على `*.manus.computer` يوجّه زر الدخول إلى الموقع المنشور، لذلك يستخدم Redirect المنشور أعلاه وتعود جلسة OAuth إلى الموقع المنشور، لا إلى Preview؛ اختبار OAuth callback مباشرة داخل Preview غير مفعّل حالياً.

في بيئة التطوير يبدأ Gateway إذا توفر `DISCORD_BOT_TOKEN`. انتبه: عند الاتصال يسجّل البوت أمر `/systemix` على كل سيرفر موجود فيه. لا تضع التوكن في بيئة تطوير إلا إذا كنت تقصد اختبار ذلك على تلك السيرفرات.

## النشر 24/7

اتصال Discord Gateway عملية طويلة العمر. **Autoscale ليس مناسباً لتشغيله الدائم**. استضافة Reserved في WebDev هي نمط العملية المستمرة لهذا المشروع. اتصال Gateway في الإنتاج محمي افتراضياً بالمتغير `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY=false`؛ لا تفعّله قبل اختيار نمط استضافة دائم، وتوفير الأسرار عبر القنوات الآمنة، واختبار الاتصال على سيرفر تجريبي. تغيير الاستضافة قد يغيّر استخدام الموارد؛ لا يُفعّل تلقائياً.

قبل اعتبار المنتج جاهزاً للبيع، يلزم أيضاً تنفيذ وحدات مركز المجتمع التي ما زالت معاينة، وتوثيق الخصوصية والاحتفاظ بالسجلات، وإكمال اختبارات الأذونات والاستجابة للتوقف وإعادة الاتصال على سيرفر تملكه.

## متغيرات البيئة

راجع [`.env.example`](./.env.example). لا تحفظ `.env` ولا Client Secret ولا Bot Token في المستودع. في WebDev استخدم إدخال الأسرار الآمن. القيمتان `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY` و`SYSTEMIX_ENABLE_GUILD_MEMBERS_INTENT` تبقيان `false` حتى تفعيل الشروط المذكورة أعلاه.

## مراجع Discord الرسمية

- [OAuth2](https://docs.discord.com/developers/topics/oauth2)
- [Permissions and role hierarchy](https://docs.discord.com/developers/topics/permissions)
- [Gateway and intents](https://docs.discord.com/developers/events/gateway)
- [Gateway events](https://docs.discord.com/developers/events/gateway-events)
- [Auto Moderation API](https://docs.discord.com/developers/resources/auto-moderation)
- [Audit Log](https://docs.discord.com/developers/resources/audit-log)
- [Rate limits](https://docs.discord.com/developers/topics/rate-limits)
