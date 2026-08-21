/* ============================================================
   config.js — ตั้งค่าเชื่อมต่อ Supabase
   ------------------------------------------------------------
   ปล่อยว่างไว้ = เว็บทำงาน "โหมดเครื่องเดียว" (เก็บข้อมูลในเบราว์เซอร์)
   ใส่ค่าครบ   = เว็บทำงาน "โหมดออนไลน์" ทุกเครื่องเห็นข้อมูลเดียวกัน

   เอาค่ามาจากไหน
     Supabase Dashboard > โปรเจกต์ของคุณ > Project Settings > API
       • Project URL      -> ใส่ที่ url
       • anon public key  -> ใส่ที่ anonKey

   คีย์ anon เปิดเผยได้ ไม่ใช่ความลับ — ความปลอดภัยมาจาก Row Level Security
   ที่ตั้งไว้ในไฟล์ supabase/schema.sql
   (ห้ามเอา service_role key มาใส่ตรงนี้เด็ดขาด)
   ============================================================ */

window.SUPABASE_CONFIG = {
  url: '',
  anonKey: ''
};

/* เวอร์ชัน supabase-js ที่ใช้ (อัปเดตได้ที่นี่) */
window.SUPABASE_SDK = 'https://esm.sh/@supabase/supabase-js@2.49.9';

/* ตั้งเป็น true ถ้าเปิด "Confirm email" ใน Supabase (ต้องตั้ง custom SMTP ก่อน)
   ถ้าเป็น false นักเรียนสมัครแล้วเข้าใช้งานได้ทันที */
window.REQUIRE_EMAIL_CONFIRM = false;
