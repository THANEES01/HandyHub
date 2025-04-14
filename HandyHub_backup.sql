--
-- PostgreSQL database dump
--

-- Dumped from database version 15.4
-- Dumped by pg_dump version 15.4

-- Started on 2025-04-14 15:53:13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 248 (class 1255 OID 16900)
-- Name: record_status_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.record_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO booking_status_history 
            (booking_id, previous_status, new_status, changed_at)
        VALUES 
            (NEW.id, OLD.status, NEW.status, NOW());
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.record_status_change() OWNER TO postgres;

--
-- TOC entry 247 (class 1255 OID 16898)
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_modified_column() OWNER TO postgres;

--
-- TOC entry 246 (class 1255 OID 16786)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 225 (class 1259 OID 16802)
-- Name: admins; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.admins (
    id integer NOT NULL,
    user_id integer,
    username character varying(50) NOT NULL,
    is_super_admin boolean DEFAULT false
);


ALTER TABLE public.admins OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16801)
-- Name: admins_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.admins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.admins_id_seq OWNER TO postgres;

--
-- TOC entry 3539 (class 0 OID 0)
-- Dependencies: 224
-- Name: admins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.admins_id_seq OWNED BY public.admins.id;


--
-- TOC entry 233 (class 1259 OID 16873)
-- Name: booking_reviews; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_reviews (
    id integer NOT NULL,
    booking_id integer NOT NULL,
    customer_id integer NOT NULL,
    provider_id integer NOT NULL,
    rating integer NOT NULL,
    review_text text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT booking_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


ALTER TABLE public.booking_reviews OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16872)
-- Name: booking_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.booking_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.booking_reviews_id_seq OWNER TO postgres;

--
-- TOC entry 3540 (class 0 OID 0)
-- Dependencies: 232
-- Name: booking_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.booking_reviews_id_seq OWNED BY public.booking_reviews.id;


--
-- TOC entry 231 (class 1259 OID 16853)
-- Name: booking_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.booking_status_history (
    id integer NOT NULL,
    booking_id integer NOT NULL,
    previous_status character varying(50),
    new_status character varying(50) NOT NULL,
    status_change_reason text,
    changed_by integer,
    changed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.booking_status_history OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 16852)
-- Name: booking_status_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.booking_status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.booking_status_history_id_seq OWNER TO postgres;

--
-- TOC entry 3541 (class 0 OID 0)
-- Dependencies: 230
-- Name: booking_status_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.booking_status_history_id_seq OWNED BY public.booking_status_history.id;


--
-- TOC entry 227 (class 1259 OID 16817)
-- Name: category_pricing_models; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.category_pricing_models (
    id integer NOT NULL,
    category_name character varying(100) NOT NULL,
    default_fee_type character varying(20) DEFAULT 'per visit'::character varying NOT NULL,
    description text
);


ALTER TABLE public.category_pricing_models OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16816)
-- Name: category_pricing_models_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.category_pricing_models_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.category_pricing_models_id_seq OWNER TO postgres;

--
-- TOC entry 3542 (class 0 OID 0)
-- Dependencies: 226
-- Name: category_pricing_models_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.category_pricing_models_id_seq OWNED BY public.category_pricing_models.id;


--
-- TOC entry 243 (class 1259 OID 16958)
-- Name: cities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cities (
    id integer NOT NULL,
    city_name character varying(100) NOT NULL,
    state_id integer NOT NULL
);


ALTER TABLE public.cities OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 16957)
-- Name: cities_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.cities_id_seq OWNER TO postgres;

--
-- TOC entry 3543 (class 0 OID 0)
-- Dependencies: 242
-- Name: cities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cities_id_seq OWNED BY public.cities.id;


--
-- TOC entry 223 (class 1259 OID 16790)
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    user_id integer,
    first_name character varying(50),
    last_name character varying(50),
    phone_number character varying(20)
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16789)
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.customers_id_seq OWNER TO postgres;

--
-- TOC entry 3544 (class 0 OID 0)
-- Dependencies: 222
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- TOC entry 239 (class 1259 OID 16937)
-- Name: payment_methods; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_methods (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone
);


ALTER TABLE public.payment_methods OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 16936)
-- Name: payment_methods_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payment_methods_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payment_methods_id_seq OWNER TO postgres;

--
-- TOC entry 3545 (class 0 OID 0)
-- Dependencies: 238
-- Name: payment_methods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payment_methods_id_seq OWNED BY public.payment_methods.id;


--
-- TOC entry 237 (class 1259 OID 16919)
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    booking_id integer,
    customer_id integer,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50) NOT NULL,
    payment_reference character varying(255),
    status character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    base_fee numeric(10,2),
    service_charge numeric(10,2)
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 16918)
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.payments_id_seq OWNER TO postgres;

--
-- TOC entry 3546 (class 0 OID 0)
-- Dependencies: 236
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- TOC entry 235 (class 1259 OID 16903)
-- Name: provider_availability; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.provider_availability (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    day_of_week character varying(10) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    slot_duration integer NOT NULL,
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.provider_availability OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 16902)
-- Name: provider_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.provider_availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.provider_availability_id_seq OWNER TO postgres;

--
-- TOC entry 3547 (class 0 OID 0)
-- Dependencies: 234
-- Name: provider_availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.provider_availability_id_seq OWNED BY public.provider_availability.id;


--
-- TOC entry 245 (class 1259 OID 16972)
-- Name: provider_coverage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.provider_coverage (
    id integer NOT NULL,
    provider_id integer NOT NULL,
    city_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.provider_coverage OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 16971)
-- Name: provider_coverage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.provider_coverage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.provider_coverage_id_seq OWNER TO postgres;

--
-- TOC entry 3548 (class 0 OID 0)
-- Dependencies: 244
-- Name: provider_coverage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.provider_coverage_id_seq OWNED BY public.provider_coverage.id;


--
-- TOC entry 229 (class 1259 OID 16830)
-- Name: service_bookings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_bookings (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    provider_id integer NOT NULL,
    service_type character varying(255) NOT NULL,
    issue_description text NOT NULL,
    service_address text NOT NULL,
    access_instructions text,
    preferred_date date NOT NULL,
    time_slot character varying(50) NOT NULL,
    customer_name character varying(255) NOT NULL,
    customer_phone character varying(50) NOT NULL,
    customer_email character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'Pending'::character varying NOT NULL,
    images text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    payment_status character varying(50) DEFAULT 'Pending'::character varying,
    payment_method character varying(50),
    payment_reference character varying(255),
    base_fee numeric(10,2),
    fee_type character varying(50),
    completed_at timestamp without time zone,
    cancellation_reason text,
    cancelled_at timestamp without time zone,
    cancelled_by character varying(50)
);


ALTER TABLE public.service_bookings OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16829)
-- Name: service_bookings_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.service_bookings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.service_bookings_id_seq OWNER TO postgres;

--
-- TOC entry 3549 (class 0 OID 0)
-- Dependencies: 228
-- Name: service_bookings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.service_bookings_id_seq OWNED BY public.service_bookings.id;


--
-- TOC entry 219 (class 1259 OID 16761)
-- Name: service_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_categories (
    id integer NOT NULL,
    provider_id integer,
    category_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    base_fee numeric(10,2) DEFAULT 0.00,
    fee_type character varying(20) DEFAULT 'per visit'::character varying
);


ALTER TABLE public.service_categories OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16760)
-- Name: service_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.service_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.service_categories_id_seq OWNER TO postgres;

--
-- TOC entry 3550 (class 0 OID 0)
-- Dependencies: 218
-- Name: service_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.service_categories_id_seq OWNED BY public.service_categories.id;


--
-- TOC entry 217 (class 1259 OID 16743)
-- Name: service_providers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.service_providers (
    id integer NOT NULL,
    user_id integer,
    business_name character varying(255) NOT NULL,
    phone_number character varying(50) NOT NULL,
    certification_url character varying(255),
    is_verified boolean DEFAULT false,
    verification_status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.service_providers OWNER TO postgres;

--
-- TOC entry 216 (class 1259 OID 16742)
-- Name: service_providers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.service_providers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.service_providers_id_seq OWNER TO postgres;

--
-- TOC entry 3551 (class 0 OID 0)
-- Dependencies: 216
-- Name: service_providers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.service_providers_id_seq OWNED BY public.service_providers.id;


--
-- TOC entry 221 (class 1259 OID 16774)
-- Name: services_offered; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.services_offered (
    id integer NOT NULL,
    provider_id integer,
    service_name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.services_offered OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16773)
-- Name: services_offered_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.services_offered_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.services_offered_id_seq OWNER TO postgres;

--
-- TOC entry 3552 (class 0 OID 0)
-- Dependencies: 220
-- Name: services_offered_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.services_offered_id_seq OWNED BY public.services_offered.id;


--
-- TOC entry 241 (class 1259 OID 16947)
-- Name: states; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.states (
    id integer NOT NULL,
    state_code character varying(5) NOT NULL,
    state_name character varying(100) NOT NULL
);


ALTER TABLE public.states OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 16946)
-- Name: states_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.states_id_seq OWNER TO postgres;

--
-- TOC entry 3553 (class 0 OID 0)
-- Dependencies: 240
-- Name: states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.states_id_seq OWNED BY public.states.id;


--
-- TOC entry 215 (class 1259 OID 16729)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    user_type character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT users_user_type_check CHECK (((user_type)::text = ANY ((ARRAY['customer'::character varying, 'provider'::character varying, 'admin'::character varying])::text[])))
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 214 (class 1259 OID 16728)
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.users_id_seq OWNER TO postgres;

--
-- TOC entry 3554 (class 0 OID 0)
-- Dependencies: 214
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- TOC entry 3266 (class 2604 OID 16805)
-- Name: admins id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins ALTER COLUMN id SET DEFAULT nextval('public.admins_id_seq'::regclass);


--
-- TOC entry 3276 (class 2604 OID 16876)
-- Name: booking_reviews id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_reviews ALTER COLUMN id SET DEFAULT nextval('public.booking_reviews_id_seq'::regclass);


--
-- TOC entry 3274 (class 2604 OID 16856)
-- Name: booking_status_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history ALTER COLUMN id SET DEFAULT nextval('public.booking_status_history_id_seq'::regclass);


--
-- TOC entry 3268 (class 2604 OID 16820)
-- Name: category_pricing_models id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_pricing_models ALTER COLUMN id SET DEFAULT nextval('public.category_pricing_models_id_seq'::regclass);


--
-- TOC entry 3288 (class 2604 OID 16961)
-- Name: cities id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities ALTER COLUMN id SET DEFAULT nextval('public.cities_id_seq'::regclass);


--
-- TOC entry 3265 (class 2604 OID 16793)
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- TOC entry 3284 (class 2604 OID 16940)
-- Name: payment_methods id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods ALTER COLUMN id SET DEFAULT nextval('public.payment_methods_id_seq'::regclass);


--
-- TOC entry 3282 (class 2604 OID 16922)
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- TOC entry 3278 (class 2604 OID 16906)
-- Name: provider_availability id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_availability ALTER COLUMN id SET DEFAULT nextval('public.provider_availability_id_seq'::regclass);


--
-- TOC entry 3289 (class 2604 OID 16975)
-- Name: provider_coverage id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_coverage ALTER COLUMN id SET DEFAULT nextval('public.provider_coverage_id_seq'::regclass);


--
-- TOC entry 3270 (class 2604 OID 16833)
-- Name: service_bookings id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_bookings ALTER COLUMN id SET DEFAULT nextval('public.service_bookings_id_seq'::regclass);


--
-- TOC entry 3259 (class 2604 OID 16764)
-- Name: service_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories ALTER COLUMN id SET DEFAULT nextval('public.service_categories_id_seq'::regclass);


--
-- TOC entry 3254 (class 2604 OID 16746)
-- Name: service_providers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_providers ALTER COLUMN id SET DEFAULT nextval('public.service_providers_id_seq'::regclass);


--
-- TOC entry 3263 (class 2604 OID 16777)
-- Name: services_offered id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services_offered ALTER COLUMN id SET DEFAULT nextval('public.services_offered_id_seq'::regclass);


--
-- TOC entry 3287 (class 2604 OID 16950)
-- Name: states id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.states ALTER COLUMN id SET DEFAULT nextval('public.states_id_seq'::regclass);


--
-- TOC entry 3251 (class 2604 OID 16732)
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- TOC entry 3513 (class 0 OID 16802)
-- Dependencies: 225
-- Data for Name: admins; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.admins (id, user_id, username, is_super_admin) FROM stdin;
1	4	admin	f
\.


--
-- TOC entry 3521 (class 0 OID 16873)
-- Dependencies: 233
-- Data for Name: booking_reviews; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_reviews (id, booking_id, customer_id, provider_id, rating, review_text, created_at) FROM stdin;
\.


--
-- TOC entry 3519 (class 0 OID 16853)
-- Dependencies: 231
-- Data for Name: booking_status_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.booking_status_history (id, booking_id, previous_status, new_status, status_change_reason, changed_by, changed_at) FROM stdin;
\.


--
-- TOC entry 3515 (class 0 OID 16817)
-- Dependencies: 227
-- Data for Name: category_pricing_models; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.category_pricing_models (id, category_name, default_fee_type, description) FROM stdin;
1	plumbing	per visit	Base fee covers initial assessment and consultation
2	electrical	per visit	Base fee covers initial assessment and consultation
3	roofing	per visit	Base fee covers roof inspection and assessment
4	pest_control	per visit	Base fee covers inspection and assessment
5	carpentry	per visit	Base fee covers consultation and assessment
6	ac_service	per visit	Base fee covers system inspection and diagnostics
7	landscaping	per visit	Base fee covers site assessment and consultation
8	cleaning	per hour	Fee is charged on an hourly basis
9	appliance	per visit	Base fee covers diagnostics and assessment
\.


--
-- TOC entry 3531 (class 0 OID 16958)
-- Dependencies: 243
-- Data for Name: cities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cities (id, city_name, state_id) FROM stdin;
1	Johor Bahru	1
2	Iskandar Puteri	1
3	Pasir Gudang	1
4	Batu Pahat	1
5	Kluang	1
6	Segamat	1
7	Muar	1
8	Kulai	1
9	Pontian	1
10	Kota Tinggi	1
11	Tangkak	1
12	Yong Peng	1
13	Simpang Renggam	1
14	Rengit	1
15	Pekan Nanas	1
16	Ulu Tiram	1
17	Skudai	1
18	Senai	1
19	Masai	1
20	Labis	1
21	Chaah	1
22	Bakri	1
23	Parit Raja	1
24	Benut	1
25	Ayer Hitam	1
26	Pagoh	1
27	Bukit Gambir	1
28	Sri Gading	1
29	Endau	1
30	Pengerang	1
31	Tenggaroh	1
32	Sungai Rengit	1
33	Alor Setar	2
34	Sungai Petani	2
35	Kulim	2
36	Langkawi	2
37	Jitra	2
38	Kota Bharu	3
39	Pasir Mas	3
40	Tumpat	3
41	Tanah Merah	3
42	Machang	3
43	Kuala Krai	3
44	Gua Musang	3
45	Jeli	3
46	Bachok	3
47	Pasir Puteh	3
48	Rantau Panjang	3
49	Wakaf Bharu	3
50	Pengkalan Chepa	3
51	Ketereh	3
52	Dabong	3
53	Melaka City	4
54	Ayer Keroh	4
55	Batu Berendam	4
56	Alor Gajah	4
57	Jasin	4
58	Bukit Beruang	4
59	Masjid Tanah	4
60	Merlimau	4
61	Durian Tunggal	4
62	Tangga Batu	4
63	Tanjung Kling	4
64	Seremban	5
65	Nilai	5
66	Port Dickson	5
67	Bahau	5
68	Kuala Pilah	5
69	Tampin	5
70	Rembau	5
71	Gemas	5
72	Lukut	5
73	Mantin	5
74	Senawang	5
75	Lenggeng	5
76	Juasseh	5
77	Batu Kikir	5
78	Pedas	5
79	Kuantan	6
80	Temerloh	6
81	Bentong	6
82	Raub	6
83	Jerantut	6
84	Kuala Lipis	6
85	Maran	6
86	Pekan	6
87	Rompin	6
88	Bera	6
89	Gambang	6
90	Karak	6
91	Triang	6
92	Chenor	6
93	Sungai Lembing	6
94	Jengka	6
95	Genting Highlands	6
96	George Town	7
97	Bayan Lepas	7
98	Gelugor	7
99	Ayer Itam	7
100	Tanjung Tokong	7
101	Tanjung Bungah	7
102	Batu Ferringhi	7
103	Balik Pulau	7
104	Bukit Mertajam	7
105	Seberang Jaya	7
106	Butterworth	7
107	Nibong Tebal	7
108	Kepala Batas	7
109	Permatang Pauh	7
110	Simpang Ampat	7
111	Juru	7
112	Sungai Ara	7
113	Teluk Kumbar	7
114	Batu Maung	7
115	Penaga	7
116	Ipoh	8
117	Taiping	8
118	Batu Gajah	8
119	Teluk Intan	8
120	Kuala Kangsar	8
121	Seri Iskandar	8
122	Lumut	8
123	Sitiawan	8
124	Parit Buntar	8
125	Kampar	8
126	Tapah	8
127	Tanjung Malim	8
128	Manjung	8
129	Ayer Tawar	8
130	Pantai Remis	8
131	Simpang Pulai	8
132	Bagan Serai	8
133	Slim River	8
134	Tronoh	8
135	Kangar	9
136	Arau	9
137	Kuala Perlis	9
138	Shah Alam	10
139	Petaling Jaya	10
140	Subang Jaya	10
141	Selayang	10
142	Kajang	10
143	Sepang	10
144	Klang	10
145	Puchong	10
146	Ampang	10
147	Rawang	10
148	Batu Caves	10
149	Bandar Baru Bangi	10
150	Seri Kembangan	10
151	Hulu Langat	10
152	Bukit Beruntung	10
153	Sungai Buloh	10
154	Tanjung Karang	10
155	Meru	10
156	Kapar	10
157	Bestari Jaya	10
158	Kuala Terengganu	11
159	Dungun	11
160	Kemaman	11
161	Marang	11
162	Chukai	11
163	Kijal	11
164	Besut	11
165	Permaisuri	11
166	Setiu	11
167	Paka	11
168	Kota Kinabalu	12
169	Sandakan	12
170	Tawau	12
171	Lahad Datu	12
172	Keningau	12
173	Semporna	12
174	Kudat	12
175	Beaufort	12
176	Papar	12
177	Tuaran	12
178	Kota Belud	12
179	Ranau	12
180	Sipitang	12
181	Tenom	12
182	Tambunan	12
183	Kunak	12
184	Pitas	12
185	Kota Marudu	12
186	Nabawan	12
187	Kuala Penyu	12
188	Kuching	13
189	Miri	13
190	Sibu	13
191	Bintulu	13
192	Samarahan	13
193	Serian	13
194	Mukah	13
195	Kapit	13
196	Limbang	13
197	Marudi	13
198	Belaga	13
199	Sri Aman	13
200	Asajaya	13
201	Batang Ai	13
202	Tebedu	13
203	Bekenu	13
204	Tatau	13
205	Lawas	13
206	Pusa	13
207	Julau	13
208	Kuala Lumpur	14
209	Bukit Bintang	14
210	KLCC	14
211	Chinatown	14
212	Sri Hartamas	14
213	Taman Tun Dr. Ismail	14
214	Mont Kiara	14
215	Damansara	14
216	Labuan	15
217	Victoria	15
218	Rancha-Rancha	15
219	Kampung Sungai Pagar	15
220	Kampung Layang-Layang	15
221	Putrajaya	16
222	Presidential Palace	16
223	Putra Square	16
224	Putrajaya Lake	16
\.


--
-- TOC entry 3511 (class 0 OID 16790)
-- Dependencies: 223
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customers (id, user_id, first_name, last_name, phone_number) FROM stdin;
3	24	THANEES	SEHKAR	0177653153
4	25	KIRTHETHARAN	SEHKAR	0177356123
5	26	RAVENESH	SEHKAR	0177356123
6	31	AHMAD	RAZALI	0178891234
7	36	NURUL 	AISYAH	0179563421
8	38	DAVID	TAN	0172234567
\.


--
-- TOC entry 3527 (class 0 OID 16937)
-- Dependencies: 239
-- Data for Name: payment_methods; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_methods (id, name, type, display_name, is_active, created_at, updated_at) FROM stdin;
1	visa	card	Visa	t	2025-03-25 09:10:23.484048	\N
2	mastercard	card	Mastercard	t	2025-03-25 09:10:23.484048	\N
3	amex	card	American Express	t	2025-03-25 09:10:23.484048	\N
4	fpx_maybank	bank	Maybank	t	2025-03-25 09:10:23.484048	\N
5	fpx_cimb	bank	CIMB Bank	t	2025-03-25 09:10:23.484048	\N
6	fpx_rhb	bank	RHB Bank	t	2025-03-25 09:10:23.484048	\N
7	fpx_publicbank	bank	Public Bank	t	2025-03-25 09:10:23.484048	\N
8	grabpay	ewallet	GrabPay	t	2025-03-25 09:10:23.484048	\N
9	tng	ewallet	Touch n Go eWallet	t	2025-03-25 09:10:23.484048	\N
10	boost	ewallet	Boost	t	2025-03-25 09:10:23.484048	\N
\.


--
-- TOC entry 3525 (class 0 OID 16919)
-- Dependencies: 237
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, booking_id, customer_id, amount, payment_method, payment_reference, status, created_at, updated_at, base_fee, service_charge) FROM stdin;
\.


--
-- TOC entry 3523 (class 0 OID 16903)
-- Dependencies: 235
-- Data for Name: provider_availability; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.provider_availability (id, provider_id, day_of_week, start_time, end_time, slot_duration, is_available, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3533 (class 0 OID 16972)
-- Dependencies: 245
-- Data for Name: provider_coverage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.provider_coverage (id, provider_id, city_id, created_at) FROM stdin;
\.


--
-- TOC entry 3517 (class 0 OID 16830)
-- Dependencies: 229
-- Data for Name: service_bookings; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.service_bookings (id, customer_id, provider_id, service_type, issue_description, service_address, access_instructions, preferred_date, time_slot, customer_name, customer_phone, customer_email, status, images, created_at, updated_at, payment_status, payment_method, payment_reference, base_fee, fee_type, completed_at, cancellation_reason, cancelled_at, cancelled_by) FROM stdin;
\.


--
-- TOC entry 3507 (class 0 OID 16761)
-- Dependencies: 219
-- Data for Name: service_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.service_categories (id, provider_id, category_name, created_at, base_fee, fee_type) FROM stdin;
\.


--
-- TOC entry 3505 (class 0 OID 16743)
-- Dependencies: 217
-- Data for Name: service_providers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.service_providers (id, user_id, business_name, phone_number, certification_url, is_verified, verification_status, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 3509 (class 0 OID 16774)
-- Dependencies: 221
-- Data for Name: services_offered; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.services_offered (id, provider_id, service_name, created_at) FROM stdin;
\.


--
-- TOC entry 3529 (class 0 OID 16947)
-- Dependencies: 241
-- Data for Name: states; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.states (id, state_code, state_name) FROM stdin;
1	01	Johor
2	02	Kedah
3	03	Kelantan
4	04	Melaka
5	05	Negeri Sembilan
6	06	Pahang
7	07	Pulau Pinang
8	08	Perak
9	09	Perlis
10	10	Selangor
11	11	Terengganu
12	12	Sabah
13	13	Sarawak
14	14	Wilayah Persekutuan Kuala Lumpur
15	15	Wilayah Persekutuan Labuan
16	16	Wilayah Persekutuan Putrajaya
\.


--
-- TOC entry 3503 (class 0 OID 16729)
-- Dependencies: 215
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, email, password, user_type, created_at, updated_at) FROM stdin;
4	admin@handyhub.com	admin123	admin	2025-02-22 11:05:49.995646+08	2025-02-22 11:05:49.995646+08
19	thanees1502@gmail.com	$2b$10$OnQvyRPw/my02bYo2wxrYeSQ24I6Ukb/8TqXdMjwoNCn0Vi1Yphz6	provider	2025-03-13 11:39:34.372721+08	2025-03-13 11:39:34.372721+08
21	thanees0107@gmail.com	$2b$10$XwxdyTFS3OoWbO8pA6uTWeUk0LQ4grKwztkHxemnycYLZeag1mfne	provider	2025-04-07 11:03:00.499138+08	2025-04-07 11:03:00.499138+08
24	s.thanees01@gmail.com	$2b$10$6NoKBYuCrd9dV2TkR/3m4OHEhNKuyTdRdHwWESdf2zrO7sEKMqJES	customer	2025-04-08 12:20:46.896909+08	2025-04-08 12:20:46.896909+08
25	kirthetharan@gmail.com	$2b$10$N2rYXoaXc7HVLMT7E0LX6.QNLhrk.49x86gf2Hv/wL7GtoKYizJiy	customer	2025-04-08 18:43:09.982263+08	2025-04-08 18:43:09.982263+08
26	ravenesh@gmail.com	$2b$10$1NeO6/pvL5drtOz.S.Ah0uiaIJzfIiTkzBzJj3i0ysvMLP1Vv1UQq	customer	2025-04-08 19:04:15.723865+08	2025-04-08 19:04:15.723865+08
27	safeguard@example.com	$2b$10$rdHPyAsHzhOzRuy.9t0KNuaqGKMkbsI9U9r6ZyzqR2gy1pNL4LS.q	provider	2025-04-08 19:06:36.218322+08	2025-04-08 19:06:36.218322+08
29	homestyle@gmail.com	$2b$10$4g.uaUsI9w2P.BtntrxJyOd3Eoi2Wahxf3FrfsUbtjP8zTK9hRJXm	provider	2025-04-08 22:54:08.606298+08	2025-04-08 22:54:08.606298+08
30	powertech@gmail.com	$2b$10$kpo0GlAbpu8a42Iqz2fAJ.oqlvxqZbxBCZLSzN2mskappy2x5H.be	provider	2025-04-08 22:57:14.199634+08	2025-04-08 22:57:14.199634+08
31	ahmad.razali@gmail.com	$2b$10$Wh0.0UpkEUHKrMel/KnUvODcZqUBzx/CrjulVPE5IWjfvRe1r.L22	customer	2025-04-09 07:09:29.029036+08	2025-04-09 07:09:29.029036+08
32	toproof@gmail.com	$2b$10$QGYij3K6YT5cYsgmoCS6muFv6Ae6kVLoMKQWt7tnDxct/B4RAuLE6	provider	2025-04-09 07:14:55.293866+08	2025-04-09 07:14:55.293866+08
33	masterfix@gmail.com	$2b$10$4KLs7a7VupcONLnxkQJhA.Ng3E.82FgFfkK98.ZhUTZHtHQCNpdV6	provider	2025-04-09 09:23:37.134347+08	2025-04-09 09:23:37.134347+08
34	powerplumb@gmail.com	$2b$10$R5E5Vk0A9JBFxVOEuDmoae.ELG0/diHkQ1IdvH2MlPYjbgLZt0fIa	provider	2025-04-09 09:29:13.938041+08	2025-04-09 09:29:13.938041+08
35	coolbreeze@gmail.com	$2b$10$ZkOh.8mto3tb102RI29rde0TxstzJmAzvhTx.BhqKcFKJS5A8ne4q	provider	2025-04-09 09:36:07.462725+08	2025-04-09 09:36:07.462725+08
36	nurul.aisyah@gmail.com	$2b$10$ZPwrnhRPQzkR2FCfl0iRweGXTVVCubLxxD1Y1XrY20quwt/aSFt6e	customer	2025-04-09 10:37:41.28648+08	2025-04-09 10:37:41.28648+08
37	sarah.fixits@example.com	$2b$10$0dsRK5K4qI/ue43PGa3v8eAwwaDJ4TGWb.QLEO/rIDghP5aTNg.K.	provider	2025-04-09 10:44:57.411416+08	2025-04-09 10:44:57.411416+08
38	david.tan@gmail.com	$2b$10$BTygNToXtk4pRomLc6aydOZLy3qcKn8afKVXufrN/TOXUQzTAwamG	customer	2025-04-09 15:02:02.355192+08	2025-04-09 15:02:02.355192+08
39	amirplumbing@gmail.com	$2b$10$2/E1aQDK/I16FYtTmJkZuOlUI5K5wNc/FzFDx71Sr.WfmPbKZr2yu	provider	2025-04-09 15:07:20.890481+08	2025-04-09 15:07:20.890481+08
40	appliancepro@gmail.com	$2b$10$ju3I/kIcQQ02yadxgjVhuevqcc1Fj7wxHXvV1R4QdD1OPZN7LfXSi	provider	2025-04-14 15:24:43.355808+08	2025-04-14 15:24:43.355808+08
\.


--
-- TOC entry 3555 (class 0 OID 0)
-- Dependencies: 224
-- Name: admins_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.admins_id_seq', 1, true);


--
-- TOC entry 3556 (class 0 OID 0)
-- Dependencies: 232
-- Name: booking_reviews_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_reviews_id_seq', 1, false);


--
-- TOC entry 3557 (class 0 OID 0)
-- Dependencies: 230
-- Name: booking_status_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.booking_status_history_id_seq', 74, true);


--
-- TOC entry 3558 (class 0 OID 0)
-- Dependencies: 226
-- Name: category_pricing_models_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.category_pricing_models_id_seq', 9, true);


--
-- TOC entry 3559 (class 0 OID 0)
-- Dependencies: 242
-- Name: cities_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cities_id_seq', 224, true);


--
-- TOC entry 3560 (class 0 OID 0)
-- Dependencies: 222
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customers_id_seq', 8, true);


--
-- TOC entry 3561 (class 0 OID 0)
-- Dependencies: 238
-- Name: payment_methods_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payment_methods_id_seq', 10, true);


--
-- TOC entry 3562 (class 0 OID 0)
-- Dependencies: 236
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 31, true);


--
-- TOC entry 3563 (class 0 OID 0)
-- Dependencies: 234
-- Name: provider_availability_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.provider_availability_id_seq', 286, true);


--
-- TOC entry 3564 (class 0 OID 0)
-- Dependencies: 244
-- Name: provider_coverage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.provider_coverage_id_seq', 65, true);


--
-- TOC entry 3565 (class 0 OID 0)
-- Dependencies: 228
-- Name: service_bookings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_bookings_id_seq', 57, true);


--
-- TOC entry 3566 (class 0 OID 0)
-- Dependencies: 218
-- Name: service_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_categories_id_seq', 89, true);


--
-- TOC entry 3567 (class 0 OID 0)
-- Dependencies: 216
-- Name: service_providers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.service_providers_id_seq', 28, true);


--
-- TOC entry 3568 (class 0 OID 0)
-- Dependencies: 220
-- Name: services_offered_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.services_offered_id_seq', 231, true);


--
-- TOC entry 3569 (class 0 OID 0)
-- Dependencies: 240
-- Name: states_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.states_id_seq', 16, true);


--
-- TOC entry 3570 (class 0 OID 0)
-- Dependencies: 214
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 40, true);


--
-- TOC entry 3305 (class 2606 OID 16808)
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- TOC entry 3317 (class 2606 OID 16882)
-- Name: booking_reviews booking_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_reviews
    ADD CONSTRAINT booking_reviews_pkey PRIMARY KEY (id);


--
-- TOC entry 3315 (class 2606 OID 16861)
-- Name: booking_status_history booking_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3307 (class 2606 OID 16827)
-- Name: category_pricing_models category_pricing_models_category_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_pricing_models
    ADD CONSTRAINT category_pricing_models_category_name_key UNIQUE (category_name);


--
-- TOC entry 3309 (class 2606 OID 16825)
-- Name: category_pricing_models category_pricing_models_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.category_pricing_models
    ADD CONSTRAINT category_pricing_models_pkey PRIMARY KEY (id);


--
-- TOC entry 3331 (class 2606 OID 16965)
-- Name: cities cities_city_name_state_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_city_name_state_id_key UNIQUE (city_name, state_id);


--
-- TOC entry 3333 (class 2606 OID 16963)
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- TOC entry 3303 (class 2606 OID 16795)
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- TOC entry 3323 (class 2606 OID 16944)
-- Name: payment_methods payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_methods
    ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (id);


--
-- TOC entry 3321 (class 2606 OID 16925)
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- TOC entry 3319 (class 2606 OID 16911)
-- Name: provider_availability provider_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_availability
    ADD CONSTRAINT provider_availability_pkey PRIMARY KEY (id);


--
-- TOC entry 3335 (class 2606 OID 16978)
-- Name: provider_coverage provider_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_coverage
    ADD CONSTRAINT provider_coverage_pkey PRIMARY KEY (id);


--
-- TOC entry 3337 (class 2606 OID 16980)
-- Name: provider_coverage provider_coverage_provider_id_city_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_coverage
    ADD CONSTRAINT provider_coverage_provider_id_city_id_key UNIQUE (provider_id, city_id);


--
-- TOC entry 3313 (class 2606 OID 16839)
-- Name: service_bookings service_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_bookings
    ADD CONSTRAINT service_bookings_pkey PRIMARY KEY (id);


--
-- TOC entry 3299 (class 2606 OID 16767)
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- TOC entry 3296 (class 2606 OID 16754)
-- Name: service_providers service_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_providers
    ADD CONSTRAINT service_providers_pkey PRIMARY KEY (id);


--
-- TOC entry 3301 (class 2606 OID 16780)
-- Name: services_offered services_offered_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services_offered
    ADD CONSTRAINT services_offered_pkey PRIMARY KEY (id);


--
-- TOC entry 3325 (class 2606 OID 16952)
-- Name: states states_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_pkey PRIMARY KEY (id);


--
-- TOC entry 3327 (class 2606 OID 16954)
-- Name: states states_state_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_state_code_key UNIQUE (state_code);


--
-- TOC entry 3329 (class 2606 OID 16956)
-- Name: states states_state_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.states
    ADD CONSTRAINT states_state_name_key UNIQUE (state_name);


--
-- TOC entry 3294 (class 2606 OID 16739)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3310 (class 1259 OID 16850)
-- Name: idx_bookings_customer; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bookings_customer ON public.service_bookings USING btree (customer_id);


--
-- TOC entry 3311 (class 1259 OID 16851)
-- Name: idx_bookings_provider; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bookings_provider ON public.service_bookings USING btree (provider_id);


--
-- TOC entry 3297 (class 1259 OID 16828)
-- Name: idx_service_categories_fee_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_service_categories_fee_type ON public.service_categories USING btree (fee_type);


--
-- TOC entry 3358 (class 2620 OID 16901)
-- Name: service_bookings track_booking_status_changes; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER track_booking_status_changes AFTER UPDATE OF status ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION public.record_status_change();


--
-- TOC entry 3357 (class 2620 OID 16788)
-- Name: service_providers update_providers_modtime; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_providers_modtime BEFORE UPDATE ON public.service_providers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3359 (class 2620 OID 16899)
-- Name: service_bookings update_service_bookings_timestamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_service_bookings_timestamp BEFORE UPDATE ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- TOC entry 3356 (class 2620 OID 16787)
-- Name: users update_users_modtime; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_users_modtime BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 3342 (class 2606 OID 16809)
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 3347 (class 2606 OID 16883)
-- Name: booking_reviews booking_reviews_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_reviews
    ADD CONSTRAINT booking_reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.service_bookings(id);


--
-- TOC entry 3348 (class 2606 OID 16888)
-- Name: booking_reviews booking_reviews_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_reviews
    ADD CONSTRAINT booking_reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- TOC entry 3349 (class 2606 OID 16893)
-- Name: booking_reviews booking_reviews_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_reviews
    ADD CONSTRAINT booking_reviews_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id);


--
-- TOC entry 3345 (class 2606 OID 16862)
-- Name: booking_status_history booking_status_history_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.service_bookings(id);


--
-- TOC entry 3346 (class 2606 OID 16867)
-- Name: booking_status_history booking_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.booking_status_history
    ADD CONSTRAINT booking_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- TOC entry 3353 (class 2606 OID 16966)
-- Name: cities cities_state_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_state_id_fkey FOREIGN KEY (state_id) REFERENCES public.states(id) ON DELETE CASCADE;


--
-- TOC entry 3341 (class 2606 OID 16796)
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- TOC entry 3351 (class 2606 OID 16926)
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.service_bookings(id);


--
-- TOC entry 3352 (class 2606 OID 16931)
-- Name: payments payments_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- TOC entry 3350 (class 2606 OID 16912)
-- Name: provider_availability provider_availability_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_availability
    ADD CONSTRAINT provider_availability_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id);


--
-- TOC entry 3354 (class 2606 OID 16986)
-- Name: provider_coverage provider_coverage_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_coverage
    ADD CONSTRAINT provider_coverage_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.cities(id) ON DELETE CASCADE;


--
-- TOC entry 3355 (class 2606 OID 16981)
-- Name: provider_coverage provider_coverage_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.provider_coverage
    ADD CONSTRAINT provider_coverage_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id) ON DELETE CASCADE;


--
-- TOC entry 3343 (class 2606 OID 16840)
-- Name: service_bookings service_bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_bookings
    ADD CONSTRAINT service_bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.users(id);


--
-- TOC entry 3344 (class 2606 OID 16845)
-- Name: service_bookings service_bookings_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_bookings
    ADD CONSTRAINT service_bookings_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id);


--
-- TOC entry 3339 (class 2606 OID 16768)
-- Name: service_categories service_categories_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id) ON DELETE CASCADE;


--
-- TOC entry 3338 (class 2606 OID 16755)
-- Name: service_providers service_providers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.service_providers
    ADD CONSTRAINT service_providers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 3340 (class 2606 OID 16781)
-- Name: services_offered services_offered_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.services_offered
    ADD CONSTRAINT services_offered_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.service_providers(id) ON DELETE CASCADE;


-- Completed on 2025-04-14 15:53:13

--
-- PostgreSQL database dump complete
--

