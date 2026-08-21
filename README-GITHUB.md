# วิธีอัปขึ้น GitHub

แตกไฟล์ zip นี้ออกมา จะได้ไฟล์และโฟลเดอร์เหล่านี้ **อยู่ชั้นบนสุด** (ไม่มีโฟลเดอร์ครอบ)

```
public/          supabase/        vercel.json
README.md        README-SUPABASE.md   README-VERCEL.md   .gitignore
```

## ขั้นตอน

1. เข้า <https://github.com/new> → ตั้งชื่อ repository เช่น `sapara-council`
   → เลือก **Private** ก็ได้ → **อย่าติ๊ก** "Add a README file" → กด **Create repository**

2. ในหน้าที่ขึ้นมา กด **uploading an existing file**
   (หรือไปที่ `github.com/ชื่อคุณ/sapara-council/upload/main`)

3. **ลากทั้ง 2 โฟลเดอร์ (`public`, `supabase`) และไฟล์ที่เหลือทั้งหมด** วางลงในหน้าเว็บพร้อมกัน
   GitHub จะเก็บโครงสร้างโฟลเดอร์ให้เอง

4. ใส่ข้อความในช่อง commit เช่น `เว็บไซต์สภานักเรียน เวอร์ชันแรก` → กด **Commit changes**

## ผลลัพธ์ที่ถูกต้อง

หน้า repository ต้องเห็นแบบนี้ — `public` กับ `vercel.json` อยู่ชั้นบนสุด

```
sapara-council/
├── public/
├── supabase/
├── .gitignore
├── README.md
├── README-SUPABASE.md
├── README-VERCEL.md
└── vercel.json
```

> ถ้าเห็นเป็น `sapara-council/sapara-council/public/` แปลว่าลากโฟลเดอร์ครอบขึ้นไปด้วย
> ให้ลบ repository แล้วทำใหม่ โดยลากเฉพาะ **สิ่งที่อยู่ข้างใน** โฟลเดอร์

## หมายเหตุ

- ไฟล์ `.gitignore` ขึ้นต้นด้วยจุด บางเครื่องจะซ่อนไว้
  - **Windows** — ในหน้าต่างเลือกไฟล์ พิมพ์ `.gitignore` ในช่องชื่อไฟล์
  - **Mac** — กด `Cmd + Shift + .` เพื่อแสดงไฟล์ซ่อน
  - ถ้าอัปไม่ได้จริง ๆ ข้ามไปก็ได้ ไม่กระทบการทำงานของเว็บ

- อัปเสร็จแล้วไปต่อที่ **README-VERCEL.md** เพื่อเชื่อม Vercel

- หลังจากนี้ทุกครั้งที่แก้ไฟล์บน GitHub เว็บบน Vercel จะอัปเดตให้อัตโนมัติภายในไม่กี่วินาที
