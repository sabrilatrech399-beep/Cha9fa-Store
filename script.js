CREATE OR REPLACE FUNCTION public.redeem_product(
  p_product_id bigint,
  p_player_name text,
  p_country text,
  p_game_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_points bigint;
  v_price bigint;
  v_product_name text;
  v_redemption_id uuid;
BEGIN
  -- التحقق من تسجيل الدخول
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول أولاً';
  END IF;

  -- التحقق من البيانات
  IF trim(coalesce(p_player_name, '')) = '' THEN
    RAISE EXCEPTION 'اسم اللاعب مطلوب';
  END IF;

  IF trim(coalesce(p_country, '')) = '' THEN
    RAISE EXCEPTION 'الدولة مطلوبة';
  END IF;

  IF trim(coalesce(p_game_id, '')) = '' THEN
    RAISE EXCEPTION 'ID اللعبة مطلوب';
  END IF;

  -- جلب المنتج
  SELECT name, price_points
  INTO v_product_name, v_price
  FROM public.products
  WHERE id = p_product_id
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المنتج غير موجود أو غير متاح';
  END IF;

  -- قفل حساب المستخدم لمنع الخصم المتزامن
  SELECT points_balance
  INTO v_points
  FROM public.profiles
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'حساب المستخدم غير موجود';
  END IF;

  -- التحقق من الرصيد
  IF v_points < v_price THEN
    RAISE EXCEPTION 'رصيد النقاط غير كافٍ';
  END IF;

  -- إنشاء طلب الاستبدال
  INSERT INTO public.redemptions (
    user_id,
    product_id,
    points_cost,
    player_name,
    country,
    game_id,
    status
  )
  VALUES (
    v_user_id,
    p_product_id,
    v_price,
    trim(p_player_name),
    trim(p_country),
    trim(p_game_id),
    'pending'
  )
  RETURNING id INTO v_redemption_id;

  -- خصم النقاط
  UPDATE public.profiles
  SET
    points_balance = points_balance - v_price,
    updated_at = now()
  WHERE id = v_user_id;

  -- تسجيل عملية الخصم
  INSERT INTO public.points_transactions (
    user_id,
    amount,
    transaction_type,
    reference_id,
    description
  )
  VALUES (
    v_user_id,
    -v_price,
    'debit',
    v_redemption_id,
    'استبدال المنتج: ' || v_product_name
  );

  -- النتيجة
  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_redemption_id,
    'product', v_product_name,
    'points_spent', v_price,
    'remaining_points', v_points - v_price
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;
