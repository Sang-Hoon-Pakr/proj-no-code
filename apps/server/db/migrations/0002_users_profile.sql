-- 0002_users_profile: users 테이블에 닉네임/이미지/상태메시지 추가
-- 데이터 모델 문서: docs/data-model.md (users)

ALTER TABLE users ADD COLUMN nickname VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN profile_image_url TEXT;
ALTER TABLE users ADD COLUMN status_message VARCHAR(200);
