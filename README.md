# Security Systemix

لوحة عربية RTL وبوت Discord قيد التطوير، مع أولوية للحماية ومركز وحدات متعدد المجالات. المشروع يستخدم React وExpress وtRPC وDrizzle/MySQL و`discord.js`.

## الحالة الفعلية

- لوحة التحكم ومركز الوحدات جاهزان للمعاينة؛ ليست كل بطاقات الوحدات وظائف Discord حية.
- صفحة Discord تحتوي مسار OAuth2، اختيار السيرفر بعد التحقق من Manage Server، تخزين الإعدادات لكل سيرفر، وواجهات حالة وسجلات.
- النواة الحية المعدّة للكود: مراقبة أحداث Audit Log الحساسة والتنبيه فقط، مؤشرات Anti-Raid عند تفعيل Member Intent، وقواعد Discord AutoMod التي لا تُطبّق إلا بتأكيد صريح، وأمرا Slash هما `/systemix status` و`/systemix simulate`.
- لا تنفذ Anti-Nuke أو Anti-Raid حالياً حظراً أو طرداً أو قفلاً تلقائياً. AutoMod فقط هو إجراء فعلي اختياري بعد تأكيد مسؤول السيرفر.
- OAuth Client Secret وBot Token غير موجودين في المستودع. بدون إضافتهما بأمان ستكون حالة البوت `not_configured`؛ والإنتاج محمي افتراضياً بمتغير `SYSTEMIX_ENABLE_PRODUCTION_GATEWAY=false`.
- التذاكر والفعاليات والترحيب والمستويات والنسخ الاحتياطي والاشتراكات ما زالت في مركز معاينة وليست جاهزة للبيع.

## البداية

- `pnpm dev`: خادم التطوير، والمنفذ الافتراضي 3000.
- `pnpm build` ثم `pnpm start`: بناء وتشغيل الخادم.
- `pnpm db:migrate`: تطبيق migrations المسجلة؛ قاعدة تطوير WebDev والنشر مشتركة، لذلك لا تشغّل migrations/اختبارات كتابية عشوائية عليها.
- `pnpm check`: فحص TypeScript.
- `pnpm test`: اختبارات الوحدات.

تُحمّل بيئة WebDev قيم `DATABASE_URL` و`MANUS_JWT_SECRET` على الخادم؛ لا تضعها في الكود. يوفّر [`.env.example`](./.env.example) أسماء إعدادات Discord فقط، وهو بلا أسرار.

## الربط والنشر

اقرأ [دليل إعداد Discord والنشر](./DISCORD-SETUP.md) قبل إضافة المفاتيح أو السماح باتصال Gateway. لا يحتاج البوت Administrator، ولا يستخدم Message Content Intent. يحتاج تشغيل Gateway المستمر إلى استضافة دائمة مناسبة؛ لا تفعّل متغير الإنتاج قبل اختيارها واختبار البوت على سيرفر تجريبي.

## بنية المشروع

- `client/src/`: لوحة التحكم العربية ومركز الوحدات.
- `client/src/components/DiscordConnection.tsx`: صفحة ربط Discord وإعدادات الحماية الحية.
- `server/discord/`: OAuth المشفر، Gateway، مراقبة Audit Log، Anti-Raid، AutoMod وواجهات API.
- `server/db.ts` و`drizzle/`: تخزين الإعدادات والأحداث لكل سيرفر.
- `research/`: مقارنة ومراجع التصميم والحدود الرسمية.

لا ترفع `.env` أو أي أسرار إلى GitHub؛ استخدم حقل الأسرار الآمن للبيئة التي ستشغّل فيها البوت.
